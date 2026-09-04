import type { ItemType } from '@shared/domain';
import type { AssembledItem } from '../../scheduler/daily-set';
import type { PriorReview, ReviewRating, ScheduledReview } from '../../scheduler/fsrs';
import type { Db } from '../index';

interface ReviewRow {
  id: number;
  item_type: ItemType;
  item_id: number;
  reviewed_at: string;
  rating: number;
  due_at: string;
  stability: number;
  difficulty: number;
  reps: number;
  lapses: number;
}

interface DailySetRow {
  item_type: ItemType;
  item_id: number;
  position: number;
  completed_at: string | null;
}

export interface DailySetEntry {
  readonly itemType: ItemType;
  readonly itemId: number;
  readonly position: number;
  readonly completedAt: string | null;
}

/**
 * `reviews.rating` is stored as the FSRS `Rating` enum value (`again` = 1, `good` = 3),
 * not an app-invented 0/1 — so an export or later analysis lines up with what FSRS itself
 * means by the number, without a translation table living only in this file's head.
 */
const RATING_CODE: Readonly<Record<ReviewRating, number>> = { again: 1, good: 3 };

function inClause(ids: readonly number[]): string {
  return ids.map(() => '?').join(', ');
}

export class ReviewsRepository {
  constructor(private readonly db: Db) {}

  /** The state a review builds on. Null means the item has never been reviewed. */
  latestReview(itemType: ItemType, itemId: number): PriorReview | null {
    const row = this.db
      .prepare(`SELECT * FROM reviews WHERE item_type = ? AND item_id = ? ORDER BY id DESC LIMIT 1`)
      .get(itemType, itemId) as ReviewRow | undefined;
    if (!row) return null;
    return {
      reviewedAt: new Date(row.reviewed_at),
      dueAt: new Date(row.due_at),
      stability: row.stability,
      difficulty: row.difficulty,
      reps: row.reps,
      lapses: row.lapses,
    };
  }

  /**
   * Records an answer against today's set: marks the item done and appends its FSRS
   * outcome, in one transaction. Returns `false` without writing anything if the item is
   * not an unanswered member of today's set — not in it at all, or already answered — so a
   * stale or repeated request from the renderer cannot double-count a review.
   *
   * `reviews` is an append-only log, never updated in place; `daily_set_items.completed_at`
   * is the only row that changes.
   */
  recordAnswer(
    setDate: string,
    itemType: ItemType,
    itemId: number,
    rating: ReviewRating,
    scheduled: ScheduledReview,
    reviewedAt: string,
  ): boolean {
    const write = this.db.transaction((): boolean => {
      const changes = this.db
        .prepare(
          `UPDATE daily_set_items SET completed_at = @reviewedAt
           WHERE set_date = @setDate AND item_type = @itemType AND item_id = @itemId
             AND completed_at IS NULL`,
        )
        .run({ setDate, itemType, itemId, reviewedAt }).changes;
      if (changes === 0) return false;

      this.db
        .prepare(
          `INSERT INTO reviews (item_type, item_id, reviewed_at, rating, due_at, stability, difficulty, reps, lapses)
           VALUES (@itemType, @itemId, @reviewedAt, @rating, @dueAt, @stability, @difficulty, @reps, @lapses)`,
        )
        .run({
          itemType,
          itemId,
          reviewedAt,
          rating: RATING_CODE[rating],
          dueAt: scheduled.dueAt.toISOString(),
          stability: scheduled.stability,
          difficulty: scheduled.difficulty,
          reps: scheduled.reps,
          lapses: scheduled.lapses,
        });
      return true;
    });
    return write();
  }

  /**
   * Splits candidate ids into due (reviewed before, latest due date at or before `asOf`,
   * most overdue first) and unseen (never reviewed at all). Both feed
   * [`assembleDailySet`](../../scheduler/daily-set.ts) directly — this is the only place
   * "latest row per item" is computed, via `MAX(id)` grouped by item, since `reviews` is
   * append-only and has no other way to name the current row for an item.
   */
  splitByDue(
    itemType: ItemType,
    itemIds: readonly number[],
    asOf: string,
  ): { readonly due: readonly number[]; readonly unseen: readonly number[] } {
    if (itemIds.length === 0) return { due: [], unseen: [] };
    const placeholders = inClause(itemIds);

    const reviewed = new Set(
      (
        this.db
          .prepare(
            `SELECT DISTINCT item_id FROM reviews WHERE item_type = ? AND item_id IN (${placeholders})`,
          )
          .all(itemType, ...itemIds) as { item_id: number }[]
      ).map((row) => row.item_id),
    );

    const due = (
      this.db
        .prepare(
          `WITH latest AS (
             SELECT item_id, MAX(id) AS max_id
             FROM reviews
             WHERE item_type = ? AND item_id IN (${placeholders})
             GROUP BY item_id
           )
           SELECT r.item_id AS item_id
           FROM reviews r
           JOIN latest l ON l.item_id = r.item_id AND l.max_id = r.id
           WHERE r.due_at <= ?
           ORDER BY r.due_at ASC`,
        )
        .all(itemType, ...itemIds, asOf) as { item_id: number }[]
    ).map((row) => row.item_id);

    const unseen = itemIds.filter((id) => !reviewed.has(id));
    return { due, unseen };
  }

  /** Today's set, in assembly order — empty means it has not been assembled yet. */
  dailySetFor(setDate: string): readonly DailySetEntry[] {
    const rows = this.db
      .prepare(
        `SELECT item_type, item_id, position, completed_at
         FROM daily_set_items WHERE set_date = ? ORDER BY position ASC`,
      )
      .all(setDate) as DailySetRow[];
    return rows.map((row) => ({
      itemType: row.item_type,
      itemId: row.item_id,
      position: row.position,
      completedAt: row.completed_at,
    }));
  }

  /**
   * Freezes an assembled set for the day, in one transaction. `INSERT OR IGNORE` against
   * the `(set_date, item_type, item_id)` unique index rather than a existence check first:
   * cheap, and correct even if this were ever called twice for the same day.
   */
  writeDailySet(setDate: string, items: readonly AssembledItem[]): void {
    if (items.length === 0) return;
    const insert = this.db.prepare(
      `INSERT OR IGNORE INTO daily_set_items (set_date, item_type, item_id, position)
       VALUES (@setDate, @itemType, @itemId, @position)`,
    );
    const write = this.db.transaction(() => {
      for (const item of items) insert.run({ setDate, ...item });
    });
    write();
  }

  /** Whether any of today's items are still unanswered — what the reminder checks. */
  hasUnfinished(setDate: string): boolean {
    const row = this.db
      .prepare(
        `SELECT 1 AS present FROM daily_set_items
         WHERE set_date = ? AND completed_at IS NULL LIMIT 1`,
      )
      .get(setDate) as { present: number } | undefined;
    return row !== undefined;
  }
}

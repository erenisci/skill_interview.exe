import type { Favorite, ItemType } from '@shared/domain';
import type { Db } from '../index';

interface FavoriteRow {
  id: number;
  item_type: ItemType;
  item_id: number;
  note: string | null;
  created_at: string;
}

function toFavorite(row: FavoriteRow): Favorite {
  return {
    id: row.id,
    itemType: row.item_type,
    itemId: row.item_id,
    note: row.note,
    createdAt: row.created_at,
  };
}

/**
 * What the user chose to keep.
 *
 * Deliberately holds no foreign key to the card or question it names — the same
 * polymorphic-reference reason as `reviews` and `daily_set_items`, plus one of its own:
 * deleting a skill cascades its cards and questions away, and a favourite must outlive
 * that rather than vanish with it. The row survives as a tombstone; hydration is what
 * discovers the content is gone
 * ([erd.md](../../../../docs/architecture/erd.md), invariant 6).
 */
export class FavoritesRepository {
  constructor(private readonly db: Db) {}

  /** Newest first — the order the favourites list and the export both read in. */
  list(): readonly Favorite[] {
    const rows = this.db
      .prepare('SELECT * FROM favorites ORDER BY created_at DESC, id DESC')
      .all() as FavoriteRow[];
    return rows.map(toFavorite);
  }

  find(itemType: ItemType, itemId: number): Favorite | null {
    const row = this.db
      .prepare('SELECT * FROM favorites WHERE item_type = ? AND item_id = ?')
      .get(itemType, itemId) as FavoriteRow | undefined;
    return row ? toFavorite(row) : null;
  }

  /**
   * Adds a favourite, or returns the existing one untouched.
   *
   * Idempotent rather than erroring: favouriting something already favourited is the user
   * clicking twice, not a conflict to report — and re-adding must not silently discard a
   * note they had already written on it.
   */
  add(itemType: ItemType, itemId: number, createdAt: string): Favorite {
    const existing = this.find(itemType, itemId);
    if (existing) return existing;

    this.db
      .prepare(
        `INSERT INTO favorites (item_type, item_id, note, created_at)
         VALUES (@itemType, @itemId, NULL, @createdAt)`,
      )
      .run({ itemType, itemId, createdAt });

    const created = this.find(itemType, itemId);
    if (!created) throw new Error('favorite insert did not produce a row');
    return created;
  }

  remove(itemType: ItemType, itemId: number): boolean {
    return (
      this.db
        .prepare('DELETE FROM favorites WHERE item_type = ? AND item_id = ?')
        .run(itemType, itemId).changes > 0
    );
  }

  /** An empty or whitespace-only note is stored as NULL, not as an empty string. */
  setNote(itemType: ItemType, itemId: number, note: string | null): boolean {
    const trimmed = note?.trim();
    return (
      this.db
        .prepare('UPDATE favorites SET note = ? WHERE item_type = ? AND item_id = ?')
        .run(trimmed && trimmed.length > 0 ? trimmed : null, itemType, itemId).changes > 0
    );
  }

  count(): number {
    const row = this.db.prepare('SELECT COUNT(*) AS n FROM favorites').get() as { n: number };
    return row.n;
  }
}

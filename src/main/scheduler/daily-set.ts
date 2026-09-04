import type { ItemType } from '@shared/domain';

/**
 * Daily-set assembly — deterministic, pure, and deliberately dumb.
 *
 * "Dumb" on purpose: sorting due items by how overdue they are, and choosing which new
 * items go first, are SQL's job (`ReviewsRepository` orders its queries), not this
 * function's. This only knows how to cap and fill, which is the part worth testing in
 * isolation ([system-design.md](../../../docs/architecture/system-design.md)).
 *
 * Cards and questions are capped independently against the user's two separate counts
 * (FR-40): a skill list heavy on cards must not crowd out the day's questions, or the
 * other way round.
 */

export interface CandidateItem {
  readonly itemType: ItemType;
  readonly itemId: number;
}

export interface AssembledItem extends CandidateItem {
  /** Assembly order — stable once written, so a reopened set renders identically. */
  readonly position: number;
}

export interface DailySetCounts {
  readonly cards: number;
  readonly questions: number;
}

export interface DailySetPool {
  /** Pre-sorted by the caller, most overdue first. */
  readonly dueCards: readonly CandidateItem[];
  /** Pre-sorted by the caller's priority order; this function does not choose among them. */
  readonly newCards: readonly CandidateItem[];
  readonly dueQuestions: readonly CandidateItem[];
  readonly newQuestions: readonly CandidateItem[];
}

/**
 * Cards first, then questions — an arbitrary but stable choice, since nothing in the spec
 * requires interleaving. Within each, due items before new ones: a backlog is reviewed
 * before it grows, and days-old due items past the cap are left due rather than dropped
 * (FR-42's "capped at the configured count; the rest stays due").
 *
 * An empty pool produces an empty set. There is no filler path to accidentally trigger —
 * "nothing due and no new content" is the input producing no output, not a special case.
 */
export function assembleDailySet(
  pool: DailySetPool,
  counts: DailySetCounts,
): readonly AssembledItem[] {
  const cards = takeUpTo(pool.dueCards, pool.newCards, counts.cards);
  const questions = takeUpTo(pool.dueQuestions, pool.newQuestions, counts.questions);
  return [...cards, ...questions].map((item, position) => ({ ...item, position }));
}

function takeUpTo(
  due: readonly CandidateItem[],
  fresh: readonly CandidateItem[],
  cap: number,
): readonly CandidateItem[] {
  if (cap <= 0) return [];
  const dueTaken = due.slice(0, cap);
  const freshTaken = fresh.slice(0, cap - dueTaken.length);
  return [...dueTaken, ...freshTaken];
}

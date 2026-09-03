import { createEmptyCard, FSRS, Rating, State, type Card, type Grade } from 'ts-fsrs';

/**
 * The only file that knows `ts-fsrs` exists — same boundary discipline as `llm/ollama.ts`
 * and the search adapters. Everything outside this module works with plain dates and
 * numbers, never with the library's `Card` shape.
 *
 * **Why a library rather than a hand port.** FSRS is 21 tuned weights across seven
 * formulas, several of them exponential and mutually dependent (mean-reverting difficulty,
 * a stability update that differs for a lapse versus a success). Porting that by hand risks
 * exactly the failure this product is built to avoid elsewhere: confident, wrong output that
 * no test catches because the test was written against the same misunderstanding as the
 * code. `ts-fsrs` is MIT-licensed, has zero runtime dependencies of its own, and is
 * maintained by the algorithm's own authors — the trade this product makes everywhere else
 * (trust a focused library over reimplementing a specialist algorithm) applies here too.
 *
 * **Why two ratings, not the library's four.** FSRS is built for a self-graded four-point
 * scale (again/hard/good/easy). Nothing in this product collects that: a question's signal
 * is binary (the option picked was correct or it was not), and a card has no correctness at
 * all, only "seen it." Offering four buttons over a two-valued signal would be decoration,
 * not data, so both map onto `again` / `good` only
 * ([ADR-0007](../../../docs/architecture/adr/0007-fsrs-scheduler.md)).
 *
 * **Why `enable_short_term: false`.** The library's default mode adds an Anki-style
 * minute-scale learning-step state machine for same-day re-review. This product shows an
 * item once per day as part the daily set; there is no same-day re-review to schedule, and
 * the `reviews` table has no column for it. Long-term mode is a supported, documented FSRS
 * configuration for exactly this shape of product, not an invented shortcut.
 */

export type ReviewRating = 'again' | 'good';

/** What the previous review left behind — read from the latest `reviews` row for an item. */
export interface PriorReview {
  readonly reviewedAt: Date;
  readonly dueAt: Date;
  readonly stability: number;
  readonly difficulty: number;
  readonly reps: number;
  readonly lapses: number;
}

/** What this review produces — written as the next `reviews` row. */
export interface ScheduledReview {
  readonly dueAt: Date;
  readonly stability: number;
  readonly difficulty: number;
  readonly reps: number;
  readonly lapses: number;
}

const RATING: Readonly<Record<ReviewRating, Grade>> = {
  again: Rating.Again,
  good: Rating.Good,
};

const engine = new FSRS({ enable_short_term: false, enable_fuzz: false });

/**
 * Schedules the next due date for one item.
 *
 * Pure given its inputs: `now` is a parameter, never read from the clock, so this is
 * testable with fixed dates and produces identical output for identical input
 * ([system-design.md](../../../docs/architecture/system-design.md)). `prior === null` means
 * a new item with no review history — the library's own "new card" path, not a special case
 * bolted on here.
 */
export function schedule(
  prior: PriorReview | null,
  rating: ReviewRating,
  now: Date,
): ScheduledReview {
  const card: Card = prior
    ? {
        due: prior.dueAt,
        stability: prior.stability,
        difficulty: prior.difficulty,
        elapsed_days: 0,
        scheduled_days: 0,
        learning_steps: 0,
        reps: prior.reps,
        lapses: prior.lapses,
        state: State.Review,
        last_review: prior.reviewedAt,
      }
    : createEmptyCard(now);

  const { card: next } = engine.next(card, now, RATING[rating]);
  return {
    dueAt: next.due,
    stability: next.stability,
    difficulty: next.difficulty,
    reps: next.reps,
    lapses: next.lapses,
  };
}

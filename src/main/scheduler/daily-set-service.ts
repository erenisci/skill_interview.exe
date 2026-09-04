import type { AnswerRating, ItemType } from '@shared/domain';
import type { DailySet, DailySetEntry } from '@shared/ipc';
import { appError, err, ok, type Result } from '@shared/result';
import type { CardsRepository } from '../db/repositories/cards';
import type { QuestionsRepository } from '../db/repositories/questions';
import type { ReviewsRepository } from '../db/repositories/reviews';
import type { SettingsRepository } from '../db/repositories/settings';
import { endOfLocalDay, localDateString } from '../util/date';
import { assembleDailySet, type DailySetPool } from './daily-set';
import { schedule } from './fsrs';

/**
 * Orchestrates the daily set: assemble once per local day and freeze it, answer against
 * it, and read it back hydrated.
 *
 * Deliberately synchronous SQL only — no model call and no queue. Assembly reads
 * already-generated cards and questions and schedules against already-stored FSRS state;
 * there is nothing here for a background job to do
 * ([performance.md](../../../docs/operations/performance.md), rule 1: the read path
 * touches SQLite only).
 */

export interface DailySetDeps {
  readonly cards: CardsRepository;
  readonly questions: QuestionsRepository;
  readonly reviews: ReviewsRepository;
  readonly settings: SettingsRepository;
  readonly now?: () => Date;
}

function counts(settings: SettingsRepository): { cards: number; questions: number } {
  // Settings are user-editable strings; a corrupted or hand-edited value falls back to the
  // shipped default rather than assembling against NaN.
  const cards = Number.parseInt(settings.get('daily_cards') ?? '', 10);
  const questions = Number.parseInt(settings.get('daily_questions') ?? '', 10);
  return {
    cards: Number.isFinite(cards) && cards >= 0 ? cards : 3,
    questions: Number.isFinite(questions) && questions >= 0 ? questions : 5,
  };
}

function buildPool(deps: DailySetDeps, asOf: string): DailySetPool {
  const cardIds = deps.cards.allIds();
  const questionIds = deps.questions.allActiveIds();
  const cardSplit = deps.reviews.splitByDue('card', cardIds, asOf);
  const questionSplit = deps.reviews.splitByDue('question', questionIds, asOf);

  return {
    dueCards: cardSplit.due.map((itemId) => ({ itemType: 'card' as const, itemId })),
    newCards: cardSplit.unseen.map((itemId) => ({ itemType: 'card' as const, itemId })),
    dueQuestions: questionSplit.due.map((itemId) => ({ itemType: 'question' as const, itemId })),
    newQuestions: questionSplit.unseen.map((itemId) => ({
      itemType: 'question' as const,
      itemId,
    })),
  };
}

/** Hydrates one frozen entry, or `null` if it must no longer be shown. */
function hydrate(
  deps: DailySetDeps,
  entry: { itemType: ItemType; itemId: number; position: number; completedAt: string | null },
): DailySetEntry | null {
  if (entry.itemType === 'card') {
    const card = deps.cards.findById(entry.itemId);
    if (!card) return null;
    return {
      kind: 'card',
      position: entry.position,
      completed: entry.completedAt !== null,
      card: { card, sources: deps.cards.sourcesFor(card.id) },
    };
  }

  const question = deps.questions.findById(entry.itemId);
  // Flagged after assembly: membership is frozen, content is not — a question the user
  // has already rejected must not reappear just because it was placed before the flag
  // (docs/architecture/database-design.md).
  if (!question || question.status !== 'active') return null;
  return {
    kind: 'question',
    position: entry.position,
    completed: entry.completedAt !== null,
    question,
  };
}

/** Assembles today's set if it does not exist yet, then returns it hydrated. */
export function getTodaysSet(deps: DailySetDeps): Result<DailySet> {
  const now = (deps.now ?? (() => new Date()))();
  const date = localDateString(now);

  let frozen = deps.reviews.dailySetFor(date);
  if (frozen.length === 0) {
    const pool = buildPool(deps, endOfLocalDay(now).toISOString());
    const assembled = assembleDailySet(pool, counts(deps.settings));
    deps.reviews.writeDailySet(date, assembled);
    frozen = deps.reviews.dailySetFor(date);
  }

  const items = frozen
    .map((entry) => hydrate(deps, entry))
    .filter((entry): entry is DailySetEntry => entry !== null);

  return ok({ date, items });
}

/**
 * Records an answer: schedules the next review and marks the item done for today, in one
 * transaction ([`ReviewsRepository.recordAnswer`](../db/repositories/reviews.ts)) — a
 * scheduled review must never be written for an item the set does not actually still owe
 * an answer for, and the reverse (marked done with no schedule update) would silently
 * freeze that item's due date forever.
 */
export function recordAnswer(
  deps: DailySetDeps,
  itemType: ItemType,
  itemId: number,
  rating: AnswerRating,
): Result<void> {
  const now = (deps.now ?? (() => new Date()))();
  const date = localDateString(now);

  const prior = deps.reviews.latestReview(itemType, itemId);
  const scheduled = schedule(prior, rating, now);

  const recorded = deps.reviews.recordAnswer(
    date,
    itemType,
    itemId,
    rating,
    scheduled,
    now.toISOString(),
  );
  if (!recorded) {
    // Either not in today's set, or already answered — both are the caller sending a
    // request the current state does not support, not a server-side failure.
    return err(
      appError(
        'validation',
        'not-in-todays-set',
        `${itemType} ${itemId} is not an unanswered item in today's set`,
      ),
    );
  }
  return ok(undefined);
}

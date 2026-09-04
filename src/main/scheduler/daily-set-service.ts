import type { AnswerRating, ItemType } from '@shared/domain';
import type { DailySet, DailySetEntry } from '@shared/ipc';
import { appError, err, ok, type Result } from '@shared/result';
import type { CardsRepository } from '../db/repositories/cards';
import type { QuestionsRepository } from '../db/repositories/questions';
import type { ReviewsRepository } from '../db/repositories/reviews';
import type { SettingsRepository } from '../db/repositories/settings';
import type { SkillsRepository } from '../db/repositories/skills';
import { endOfLocalDay, localDateString } from '../util/date';
import {
  assembleDailySet,
  PER_SKILL_DEFAULTS,
  type AssembledItem,
  type DailySetCounts,
  type DailySetLimits,
  type DailySetPool,
} from './daily-set';
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
  readonly skills: SkillsRepository;
  readonly cards: CardsRepository;
  readonly questions: QuestionsRepository;
  readonly reviews: ReviewsRepository;
  readonly settings: SettingsRepository;
  readonly now?: () => Date;
}

/**
 * The day's size, summed from the skills rather than set globally.
 *
 * A skill with no limit of its own contributes `PER_SKILL_DEFAULTS`; `0` means it is paused
 * and contributes nothing. So a day grows when a skill is added and shrinks when one is
 * paused, which is what a person would expect and what a single global count could not do.
 */
function counts(limits: DailySetLimits): DailySetCounts {
  let cards = 0;
  let questions = 0;
  for (const value of limits.cards.values()) cards += value ?? PER_SKILL_DEFAULTS.cards;
  for (const value of limits.questions.values()) questions += value ?? PER_SKILL_DEFAULTS.questions;
  return { cards, questions };
}

/** How much of each kind today's set already holds. */
function tally(frozen: readonly { itemType: ItemType }[]): { cards: number; questions: number } {
  return {
    cards: frozen.filter((entry) => entry.itemType === 'card').length,
    questions: frozen.filter((entry) => entry.itemType === 'question').length,
  };
}

/** Keys of what is already in the set, so a top-up cannot offer the same item twice. */
function alreadyIn(frozen: readonly { itemType: ItemType; itemId: number }[]): ReadonlySet<string> {
  return new Set(frozen.map((entry) => `${entry.itemType}:${String(entry.itemId)}`));
}

/** Positions continue after what is already there, so the order the user saw is stable. */
function offsetBy(items: readonly AssembledItem[], start: number): readonly AssembledItem[] {
  return items.map((item, index) => ({ ...item, position: start + index }));
}

function buildPool(deps: DailySetDeps, asOf: string, exclude: ReadonlySet<string>): DailySetPool {
  const keep = (itemType: ItemType) => (row: { id: number }) =>
    !exclude.has(`${itemType}:${String(row.id)}`);

  const cards = deps.cards.allWithSkill().filter(keep('card'));
  const questions = deps.questions.allActiveWithSkill().filter(keep('question'));

  // The split queries answer in id order; the skill each item belongs to is carried
  // alongside so assembly can spread the day across skills rather than down the list.
  const cardSkill = new Map(cards.map((row) => [row.id, row.skillId]));
  const questionSkill = new Map(questions.map((row) => [row.id, row.skillId]));

  const cardSplit = deps.reviews.splitByDue(
    'card',
    cards.map((row) => row.id),
    asOf,
  );
  const questionSplit = deps.reviews.splitByDue(
    'question',
    questions.map((row) => row.id),
    asOf,
  );

  const asCards = (ids: readonly number[]) =>
    ids.map((itemId) => ({
      itemType: 'card' as const,
      itemId,
      skillId: cardSkill.get(itemId) ?? 0,
    }));
  const asQuestions = (ids: readonly number[]) =>
    ids.map((itemId) => ({
      itemType: 'question' as const,
      itemId,
      skillId: questionSkill.get(itemId) ?? 0,
    }));

  return {
    dueCards: asCards(cardSplit.due),
    newCards: asCards(cardSplit.unseen),
    dueQuestions: asQuestions(questionSplit.due),
    newQuestions: asQuestions(questionSplit.unseen),
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

  // Assemble on first look, then **top up slots that were never filled**.
  //
  // Freezing is what stops the set reshuffling around whatever has just become due, and it
  // stays. But it was also holding empty slots empty, which is not the same thing and was
  // read as a bug the first time it happened: four skills were added, research finished at
  // different times, and the set had frozen at two cards while it was still allowed four.
  // The user saw two, had no way to get the rest, and reasonably concluded it was broken.
  //
  // Only the shortfall is added, and only from material that was never in the set. Nothing
  // already in it moves or is replaced, so the guarantee the freeze exists for is intact.
  const limits = deps.skills.dailyLimits();
  const wanted = counts(limits);
  // Counted on what still renders, not on what the table holds. A frozen row whose card or
  // question is gone hydrates to nothing, so counting rows made a set of four dead entries
  // look full and the day stayed permanently empty — which is exactly what happened after a
  // skill was deleted and re-added.
  const live = frozen.filter((entry) => hydrate(deps, entry) !== null);
  const have = tally(live);
  if (have.cards < wanted.cards || have.questions < wanted.questions) {
    const pool = buildPool(deps, endOfLocalDay(now).toISOString(), alreadyIn(frozen));
    const assembled = assembleDailySet(
      pool,
      { cards: wanted.cards - have.cards, questions: wanted.questions - have.questions },
      limits,
    );
    if (assembled.length > 0) {
      deps.reviews.writeDailySet(date, offsetBy(assembled, frozen.length));
      frozen = deps.reviews.dailySetFor(date);
    }
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

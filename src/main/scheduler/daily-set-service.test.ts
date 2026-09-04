import type { Skill } from '@shared/domain';
import type { Database as Db } from 'better-sqlite3';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { migrate } from '../db/migrate';
import { CardsRepository } from '../db/repositories/cards';
import { QuestionsRepository } from '../db/repositories/questions';
import { ReviewsRepository } from '../db/repositories/reviews';
import { SettingsRepository } from '../db/repositories/settings';
import { SkillsRepository } from '../db/repositories/skills';
import { getTodaysSet, recordAnswer, type DailySetDeps } from './daily-set-service';

let db: Db;
let skills: SkillsRepository;
let cards: CardsRepository;
let questions: QuestionsRepository;
let reviews: ReviewsRepository;
let settings: SettingsRepository;

const CREATED_AT = '2026-09-03T08:00:00.000Z';

beforeEach(() => {
  db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  migrate(db);
  skills = new SkillsRepository(db);
  cards = new CardsRepository(db);
  questions = new QuestionsRepository(db);
  reviews = new ReviewsRepository(db);
  settings = new SettingsRepository(db);
});

afterEach(() => db.close());

function addSkill(name: string): Skill {
  return skills.insert({
    name,
    slug: name.toLowerCase(),
    contentLang: 'en',
    createdAt: CREATED_AT,
  });
}

function addCard(skill: Skill, title = skill.name): number {
  return cards.insertWithSources(
    {
      skillId: skill.id,
      type: 'primer',
      title,
      bodyMd: `${skill.name} is a reverse proxy. `.repeat(20),
      contentLang: 'en',
      model: 'stub',
      promptVersion: 'primer-card.v1',
      createdAt: CREATED_AT,
    },
    [
      {
        skillId: skill.id,
        url: `https://example.test/${skill.slug}`,
        title,
        publisher: 'Example',
        license: null,
        fetchedAt: CREATED_AT,
        excerpt: 'reverse proxy',
      },
    ],
  ).id;
}

function addQuestion(skill: Skill, cardId: number): number {
  return questions.insertWithOptions(
    {
      skillId: skill.id,
      cardId,
      stem: `Which of the following is true of ${skill.name}?`,
      explanation: 'Because it routes requests to backends.',
      contentLang: 'en',
      model: 'stub',
      promptVersion: 'question-stem.v1',
    },
    [
      {
        text: 'routes requests to backend services by host and path',
        rationale: skill.name,
        isCorrect: true,
        sourceSkillId: null,
      },
      {
        text: 'stores rows in a write-ahead log before committing',
        rationale: 'Traefik',
        isCorrect: false,
        sourceSkillId: null,
      },
      {
        text: 'schedules containers across a cluster of worker nodes',
        rationale: 'Kubernetes',
        isCorrect: false,
        sourceSkillId: null,
      },
      {
        text: 'caches compiled templates in memory between requests',
        rationale: 'PHP-FPM',
        isCorrect: false,
        sourceSkillId: null,
      },
    ],
  ).id;
}

function deps(now: () => Date): DailySetDeps {
  return { skills, cards, questions, reviews, settings, now };
}

describe('getTodaysSet — the exit criteria', () => {
  it('assembles new items up to the configured counts', () => {
    const nginx = addSkill('nginx');
    addCard(nginx);
    const traefik = addSkill('Traefik');
    const traefikCard = addCard(traefik);
    addQuestion(traefik, traefikCard);

    settings.set('daily_cards', '1');
    settings.set('daily_questions', '1');

    const result = getTodaysSet(deps(() => new Date('2026-09-03T09:00:00.000Z')));
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.date).toBe('2026-09-03');
    expect(result.value.items).toHaveLength(2);
    expect(result.value.items.map((i) => i.kind).sort()).toEqual(['card', 'question']);
  });

  it('resumes the same set on a second read the same day', () => {
    const nginx = addSkill('nginx');
    addCard(nginx);
    addCard(addSkill('Traefik'));
    settings.set('daily_cards', '1');

    const now = () => new Date('2026-09-03T09:00:00.000Z');
    const first = getTodaysSet(deps(now));
    const second = getTodaysSet(deps(now));
    expect(first.ok && second.ok && first.value).toEqual(second.ok && second.value);
  });

  it('produces a different set the next day once more counts are due', () => {
    // Two cards, cap of one: day one takes the first new card. Day two, nothing is due
    // yet (FSRS pushes the reviewed item's due date well past tomorrow), so it takes the
    // other new card — a different set, exactly what FR-42 requires.
    addCard(addSkill('nginx'));
    addCard(addSkill('Traefik'));
    settings.set('daily_cards', '1');

    const day1 = new Date('2026-09-03T09:00:00.000Z');
    const set1 = getTodaysSet(deps(() => day1));
    expect(set1.ok).toBe(true);
    if (!set1.ok) return;
    const firstItem = set1.value.items[0];
    expect(firstItem?.kind).toBe('card');
    if (firstItem?.kind !== 'card') return;
    recordAnswer(
      deps(() => day1),
      'card',
      firstItem.card.card.id,
      'good',
    );

    const day2 = new Date('2026-09-04T09:00:00.000Z');
    const set2 = getTodaysSet(deps(() => day2));
    expect(set2.ok).toBe(true);
    if (!set2.ok) return;

    expect(set2.value.date).toBe('2026-09-04');
    const secondItem = set2.value.items[0];
    expect(secondItem?.kind === 'card' && secondItem.card.card.id).not.toBe(firstItem.card.card.id);
  });

  it('returns an explicit empty set rather than filler when nothing is due or new', () => {
    const result = getTodaysSet(deps(() => new Date('2026-09-03T09:00:00.000Z')));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.items).toEqual([]);
  });

  it('leaves backlog past the cap due rather than showing it all at once', () => {
    addCard(addSkill('nginx'));
    addCard(addSkill('Traefik'));
    addCard(addSkill('HAProxy'));
    settings.set('daily_cards', '1');

    const result = getTodaysSet(deps(() => new Date('2026-09-03T09:00:00.000Z')));
    expect(result.ok && result.value.items).toHaveLength(1);
  });

  it("excludes a question flagged after it was already assembled into today's set", () => {
    const traefik = addSkill('Traefik');
    const cardId = addCard(traefik);
    const questionId = addQuestion(traefik, cardId);
    settings.set('daily_cards', '0');
    settings.set('daily_questions', '1');

    const now = () => new Date('2026-09-03T09:00:00.000Z');
    const first = getTodaysSet(deps(now));
    expect(first.ok && first.value.items).toHaveLength(1);

    questions.flag({
      questionId,
      target: 'question',
      reason: 'ambiguous',
      note: null,
      createdAt: CREATED_AT,
    });

    // Membership was frozen on the first read; content is re-checked on every read, so the
    // flagged question disappears without the set being reassembled around it.
    const second = getTodaysSet(deps(now));
    expect(second.ok && second.value.items).toHaveLength(0);
  });
});

describe('recordAnswer', () => {
  it('marks the item done and schedules its next review', () => {
    const nginx = addSkill('nginx');
    const cardId = addCard(nginx);
    settings.set('daily_cards', '1');
    const now = () => new Date('2026-09-03T09:00:00.000Z');

    const set = getTodaysSet(deps(now));
    expect(set.ok && set.value.items[0]?.completed).toBe(false);

    const result = recordAnswer(deps(now), 'card', cardId, 'good');
    expect(result.ok).toBe(true);

    const after = getTodaysSet(deps(now));
    expect(after.ok && after.value.items[0]?.completed).toBe(true);
    expect(reviews.latestReview('card', cardId)).not.toBeNull();
  });

  it("refuses to answer an item that is not in today's set", () => {
    const nginx = addSkill('nginx');
    const cardId = addCard(nginx);
    // No getTodaysSet call — nothing has been assembled, so nothing is answerable yet.
    const result = recordAnswer(
      deps(() => new Date('2026-09-03T09:00:00.000Z')),
      'card',
      cardId,
      'good',
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('not-in-todays-set');
  });

  it('refuses to answer the same item twice in one day', () => {
    const nginx = addSkill('nginx');
    const cardId = addCard(nginx);
    settings.set('daily_cards', '1');
    const now = () => new Date('2026-09-03T09:00:00.000Z');
    getTodaysSet(deps(now));

    expect(recordAnswer(deps(now), 'card', cardId, 'good').ok).toBe(true);
    const second = recordAnswer(deps(now), 'card', cardId, 'good');
    expect(second.ok).toBe(false);
  });

  it('does not write a review row when the item was not answerable', () => {
    const nginx = addSkill('nginx');
    const cardId = addCard(nginx);
    recordAnswer(
      deps(() => new Date('2026-09-03T09:00:00.000Z')),
      'card',
      cardId,
      'good',
    );
    // The all-or-nothing guarantee: a rejected answer leaves no trace in the schedule.
    expect(reviews.latestReview('card', cardId)).toBeNull();
  });
});

describe('getTodaysSet — topping up slots that were never filled', () => {
  const AT_NINE = () => new Date('2026-09-03T09:00:00.000Z');

  it('adds material that arrived after the set froze below its cap', () => {
    // Found live: four skills were added, research finished at different times, and the
    // set froze at two cards while still allowed four. The user saw two, had no way to
    // reach the rest, and reasonably read it as broken.
    addCard(addSkill('nginx'));
    addCard(addSkill('Traefik'));
    settings.set('daily_cards', '4');
    settings.set('daily_questions', '0');

    const first = getTodaysSet(deps(AT_NINE));
    expect(first.ok && first.value.items).toHaveLength(2);

    addCard(addSkill('HAProxy'));
    addCard(addSkill('Caddy'));

    const second = getTodaysSet(deps(AT_NINE));
    expect(second.ok && second.value.items).toHaveLength(4);
  });

  it('never exceeds the cap, however often it is read', () => {
    for (const name of ['nginx', 'Traefik', 'HAProxy', 'Caddy']) addCard(addSkill(name));
    settings.set('daily_cards', '2');
    settings.set('daily_questions', '0');

    getTodaysSet(deps(AT_NINE));
    getTodaysSet(deps(AT_NINE));
    const third = getTodaysSet(deps(AT_NINE));

    expect(third.ok && third.value.items).toHaveLength(2);
  });

  it('leaves what is already in the set exactly where it was', () => {
    // The freeze exists so the set does not reshuffle under the user. Topping up must add
    // to the end, not reorder.
    addCard(addSkill('nginx'));
    settings.set('daily_cards', '3');
    settings.set('daily_questions', '0');

    const first = getTodaysSet(deps(AT_NINE));
    const firstIds = first.ok
      ? first.value.items.map((i) => (i.kind === 'card' ? i.card.card.id : -1))
      : [];

    addCard(addSkill('Traefik'));
    const second = getTodaysSet(deps(AT_NINE));
    const secondIds = second.ok
      ? second.value.items.map((i) => (i.kind === 'card' ? i.card.card.id : -1))
      : [];

    expect(secondIds.slice(0, firstIds.length)).toEqual(firstIds);
  });

  it('does not offer the same item twice', () => {
    addCard(addSkill('nginx'));
    settings.set('daily_cards', '5');
    settings.set('daily_questions', '0');

    getTodaysSet(deps(AT_NINE));
    const second = getTodaysSet(deps(AT_NINE));
    if (!second.ok) throw new Error('expected a set');

    const ids = second.value.items.map((i) => (i.kind === 'card' ? i.card.card.id : -1));
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('adds a question that only became available later', () => {
    const traefik = addSkill('Traefik');
    const card = addCard(traefik);
    settings.set('daily_cards', '1');
    settings.set('daily_questions', '1');

    const first = getTodaysSet(deps(AT_NINE));
    expect(first.ok && first.value.items).toHaveLength(1);

    addQuestion(traefik, card);

    const second = getTodaysSet(deps(AT_NINE));
    expect(second.ok && second.value.items.map((i) => i.kind).sort()).toEqual(['card', 'question']);
  });
});

import type { Card, Favorite, Question, Skill } from '@shared/domain';
import type { FavoriteEntry } from '@shared/ipc';
import { describe, expect, it } from 'vitest';
import { groupByTag, groupKept, tagsFor } from './FavoritesView';

/**
 * The tagging rule, which decides what a person browsing Kept can find and how.
 */

const skill = (id: number, name: string): Skill => ({
  id,
  name,
  slug: name.toLowerCase(),
  category: 'language',
  tags: [],
  status: 'ready',
  contentLang: 'en',
  dailyCards: null,
  dailyQuestions: null,
  createdAt: '2026-09-04T00:00:00.000Z',
});

const favorite = (id: number): Favorite => ({
  id,
  itemType: 'card',
  itemId: id,
  note: null,
  createdAt: '2026-09-04T00:00:00.000Z',
});

const card = (type: Card['type'], relatedSkillId: number | null): Card => ({
  id: 1,
  skillId: 1,
  type,
  relatedSkillId,
  title: 'Java vs TypeScript',
  bodyMd: 'body',
  contentLang: 'en',
  model: 'stub',
  promptVersion: 'v1',
  createdAt: '2026-09-04T00:00:00.000Z',
});

const question = (): Question => ({
  id: 7,
  skillId: 1,
  cardId: 1,
  stem: 'stem',
  explanation: 'because',
  difficulty: null,
  contentLang: 'en',
  model: 'stub',
  promptVersion: 'v1',
  status: 'active',
  options: [],
});

const primer = (id: number, owner: Skill): FavoriteEntry => ({
  kind: 'card',
  favorite: favorite(id),
  skill: owner,
  relatedSkill: null,
  card: { ...card('primer', null), id },
  sources: [],
});

const comparison = (id: number, a: Skill, b: Skill): FavoriteEntry => ({
  kind: 'card',
  favorite: favorite(id),
  skill: a,
  relatedSkill: b,
  card: { ...card('comparison', b.id), id },
  sources: [],
});

describe('tagsFor', () => {
  it('files a primer under the one skill it is about', () => {
    expect(tagsFor(primer(1, skill(1, 'Java')))).toEqual(['Java']);
  });

  it('files a comparison under both sides', () => {
    // The point of the change: someone looking through Java has to find the card explaining
    // how Java differs from TypeScript. Filing it under whichever skill owns the row loses
    // half of what the card is.
    expect(tagsFor(comparison(2, skill(1, 'Java'), skill(2, 'TypeScript')))).toEqual([
      'Java',
      'TypeScript',
    ]);
  });

  it('files a question under the skill it asks about', () => {
    const entry: FavoriteEntry = {
      kind: 'question',
      favorite: { ...favorite(3), itemType: 'question' },
      skill: skill(1, 'Java'),
      question: question(),
    };
    expect(tagsFor(entry)).toEqual(['Java']);
  });

  it('falls back to one side when the other has been deleted', () => {
    const entry = comparison(4, skill(1, 'Java'), skill(2, 'TypeScript'));
    expect(tagsFor({ ...entry, relatedSkill: null } as FavoriteEntry)).toEqual(['Java']);
  });

  it('puts an orphan under its own heading', () => {
    expect(tagsFor({ kind: 'orphaned', favorite: favorite(5) })).toEqual(['No longer tracked']);
  });
});

describe('groupByTag', () => {
  it('shows a comparison in both of its groups', () => {
    const java = skill(1, 'Java');
    const ts = skill(2, 'TypeScript');
    const groups = groupByTag([comparison(1, java, ts)]);

    expect(groups.map(([tag]) => tag)).toEqual(['Java', 'TypeScript']);
    expect(groups[0]?.[1]).toHaveLength(1);
    expect(groups[1]?.[1]).toHaveLength(1);
  });

  it('collects everything about one skill under it', () => {
    const java = skill(1, 'Java');
    const ts = skill(2, 'TypeScript');
    const groups = groupByTag([primer(1, java), comparison(2, java, ts)]);

    expect(groups[0]?.[0]).toBe('Java');
    expect(groups[0]?.[1]).toHaveLength(2);
  });

  it('sorts alphabetically and leaves orphans last', () => {
    const groups = groupByTag([
      { kind: 'orphaned', favorite: favorite(9) },
      primer(1, skill(1, 'TypeScript')),
      primer(2, skill(2, 'Java')),
    ]);

    expect(groups.map(([tag]) => tag)).toEqual(['Java', 'TypeScript', 'No longer tracked']);
  });

  it('produces nothing from an empty list', () => {
    expect(groupByTag([])).toEqual([]);
  });
});

describe('groupKept', () => {
  const q = (id: number, cardId: number): FavoriteEntry => ({
    kind: 'question',
    favorite: { ...favorite(id), itemType: 'question', itemId: id },
    skill: skill(1, 'Java'),
    question: { ...question(), id, cardId },
  });

  it('puts a card first and the questions drawn from it under it', () => {
    const groups = groupKept([q(10, 1), primer(1, skill(1, 'Java')), q(11, 1)]);

    expect(groups).toHaveLength(1);
    expect(groups[0]?.[0]?.kind).toBe('card');
    expect(groups[0]?.slice(1).map((e) => (e.kind === 'question' ? e.question.id : 0))).toEqual([
      10, 11,
    ]);
  });

  it('keeps each card with its own questions', () => {
    const java = skill(1, 'Java');
    const groups = groupKept([primer(1, java), primer(2, java), q(10, 2), q(11, 1)]);

    expect(groups).toHaveLength(2);
    expect(groups[0]?.slice(1).map((e) => (e.kind === 'question' ? e.question.id : 0))).toEqual([
      11,
    ]);
    expect(groups[1]?.slice(1).map((e) => (e.kind === 'question' ? e.question.id : 0))).toEqual([
      10,
    ]);
  });

  it('still shows a question whose card was not kept', () => {
    // Keeping a question on its own is a deliberate act, not an accident to hide.
    const groups = groupKept([primer(1, skill(1, 'Java')), q(10, 99)]);

    expect(groups).toHaveLength(2);
    expect(groups[1]).toHaveLength(1);
  });

  it('collects every orphaned question into one bundle rather than one each', () => {
    const groups = groupKept([q(10, 98), q(11, 99)]);
    expect(groups).toHaveLength(1);
    expect(groups[0]).toHaveLength(2);
  });

  it('produces nothing from an empty list', () => {
    expect(groupKept([])).toEqual([]);
  });
});

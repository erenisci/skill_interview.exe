import type { Card, Favorite, Question, Skill } from '@shared/domain';
import type { FavoriteEntry } from '@shared/ipc';
import { describe, expect, it } from 'vitest';
import { groupByTag, tagsFor } from './FavoritesView';

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

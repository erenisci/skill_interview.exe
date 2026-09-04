import type { DailySetEntry } from '@shared/ipc';
import { describe, expect, it } from 'vitest';
import { groupDay } from './DailyView';

/**
 * `groupDay` is the only part of the daily view worth testing on its own: it decides the
 * order a day is read in, and it is a pure function over the set the main process returns.
 */

function card(id: number, position: number): DailySetEntry {
  return {
    kind: 'card',
    position,
    completed: false,
    card: {
      card: {
        id,
        skillId: 1,
        type: 'primer',
        relatedSkillId: null,
        title: `card ${String(id)}`,
        bodyMd: 'body',
        contentLang: 'en',
        model: 'stub',
        promptVersion: 'v1',
        createdAt: '2026-09-04T00:00:00.000Z',
      },
      sources: [],
    },
  };
}

function question(id: number, cardId: number, position: number): DailySetEntry {
  return {
    kind: 'question',
    position,
    completed: false,
    question: {
      id,
      skillId: 1,
      cardId,
      stem: `question ${String(id)}`,
      explanation: 'because',
      difficulty: null,
      contentLang: 'en',
      model: 'stub',
      promptVersion: 'v1',
      status: 'active',
      options: [],
    },
  };
}

describe('groupDay', () => {
  it('puts a card first and its own questions under it', () => {
    const groups = groupDay([card(1, 0), question(10, 1, 1), question(11, 1, 2)]);

    expect(groups).toHaveLength(1);
    expect(groups[0]?.card?.card.card.id).toBe(1);
    expect(groups[0]?.questions.map((q) => q.question.id)).toEqual([10, 11]);
  });

  it('keeps each card with its own questions, not the next card’s', () => {
    const groups = groupDay([card(1, 0), card(2, 1), question(10, 2, 2), question(11, 1, 3)]);

    expect(groups.map((g) => g.card?.card.card.id)).toEqual([1, 2]);
    expect(groups[0]?.questions.map((q) => q.question.id)).toEqual([11]);
    expect(groups[1]?.questions.map((q) => q.question.id)).toEqual([10]);
  });

  it('still shows a question whose card is not in the set today', () => {
    // Ordinary rather than exceptional: a card is due on its own schedule and its questions
    // on theirs, so the two drift apart by design.
    const groups = groupDay([card(1, 0), question(10, 99, 1)]);

    expect(groups).toHaveLength(2);
    expect(groups[1]?.card).toBeNull();
    expect(groups[1]?.questions.map((q) => q.question.id)).toEqual([10]);
  });

  it('collects every orphaned question into one group rather than one each', () => {
    const groups = groupDay([question(10, 98, 0), question(11, 99, 1)]);

    expect(groups).toHaveLength(1);
    expect(groups[0]?.questions).toHaveLength(2);
  });

  it('keeps the order the set was assembled in', () => {
    const groups = groupDay([card(2, 0), card(1, 1)]);
    expect(groups.map((g) => g.card?.card.card.id)).toEqual([2, 1]);
  });

  it('produces nothing from an empty day', () => {
    expect(groupDay([])).toEqual([]);
  });
});

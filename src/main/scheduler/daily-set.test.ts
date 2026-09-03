import { describe, expect, it } from 'vitest';
import { assembleDailySet, type DailySetPool } from './daily-set';

function pool(overrides: Partial<DailySetPool> = {}): DailySetPool {
  return {
    dueCards: [],
    newCards: [],
    dueQuestions: [],
    newQuestions: [],
    ...overrides,
  };
}

const card = (itemId: number) => ({ itemType: 'card' as const, itemId });
const question = (itemId: number) => ({ itemType: 'question' as const, itemId });

describe('assembleDailySet — the empty state is the correct answer', () => {
  it('produces nothing when the pool is empty', () => {
    expect(assembleDailySet(pool(), { cards: 3, questions: 5 })).toEqual([]);
  });

  it('produces nothing when the counts are zero, even with plenty available', () => {
    const full = pool({ dueCards: [card(1)], newQuestions: [question(1)] });
    expect(assembleDailySet(full, { cards: 0, questions: 0 })).toEqual([]);
  });
});

describe('assembleDailySet — due before new, each type capped on its own', () => {
  it('takes due items before new ones', () => {
    const result = assembleDailySet(pool({ dueCards: [card(1)], newCards: [card(2)] }), {
      cards: 2,
      questions: 0,
    });
    expect(result.map((r) => r.itemId)).toEqual([1, 2]);
  });

  it('leaves backlog past the cap due rather than dropping it', () => {
    // FR-42: capped at the configured count; the rest stays due — this function simply
    // never returns them, which is what "stays due" means at this layer.
    const result = assembleDailySet(pool({ dueCards: [card(1), card(2), card(3)] }), {
      cards: 2,
      questions: 0,
    });
    expect(result.map((r) => r.itemId)).toEqual([1, 2]);
  });

  it('fills the remainder with new items once the backlog is short', () => {
    const result = assembleDailySet(pool({ dueCards: [card(1)], newCards: [card(2), card(3)] }), {
      cards: 3,
      questions: 0,
    });
    expect(result.map((r) => r.itemId)).toEqual([1, 2, 3]);
  });

  it('caps cards and questions independently', () => {
    const result = assembleDailySet(
      pool({
        dueCards: [card(1), card(2), card(3)],
        dueQuestions: [question(10), question(11)],
      }),
      { cards: 1, questions: 2 },
    );
    expect(result).toHaveLength(3);
    expect(result.filter((r) => r.itemType === 'card')).toHaveLength(1);
    expect(result.filter((r) => r.itemType === 'question')).toHaveLength(2);
  });

  it('does not let a heavy card backlog crowd out questions, or the other way round', () => {
    const result = assembleDailySet(
      pool({ dueCards: [card(1), card(2), card(3), card(4)], newQuestions: [question(1)] }),
      { cards: 2, questions: 5 },
    );
    expect(result.filter((r) => r.itemType === 'card')).toHaveLength(2);
    expect(result.filter((r) => r.itemType === 'question')).toHaveLength(1);
  });
});

describe('assembleDailySet — ordering', () => {
  it('preserves the caller-supplied order rather than re-sorting', () => {
    // Sorting is the repository's job (most overdue first, via SQL); this function must
    // not second-guess it.
    const result = assembleDailySet(pool({ dueCards: [card(5), card(1), card(3)] }), {
      cards: 3,
      questions: 0,
    });
    expect(result.map((r) => r.itemId)).toEqual([5, 1, 3]);
  });

  it('places cards before questions and assigns contiguous positions', () => {
    const result = assembleDailySet(pool({ dueCards: [card(1)], dueQuestions: [question(9)] }), {
      cards: 1,
      questions: 1,
    });
    expect(result.map((r) => [r.itemType, r.itemId, r.position])).toEqual([
      ['card', 1, 0],
      ['question', 9, 1],
    ]);
  });

  it('numbers positions contiguously with no gaps across due and new items', () => {
    const result = assembleDailySet(pool({ dueCards: [card(1)], newCards: [card(2), card(3)] }), {
      cards: 3,
      questions: 0,
    });
    expect(result.map((r) => r.position)).toEqual([0, 1, 2]);
  });
});

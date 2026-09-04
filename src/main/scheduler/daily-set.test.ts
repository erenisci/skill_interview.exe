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

/** `skillId` defaults to the item's own id, so existing cases keep one item per skill. */
const card = (itemId: number, skillId = itemId) => ({ itemType: 'card' as const, itemId, skillId });
const question = (itemId: number, skillId = itemId) => ({
  itemType: 'question' as const,
  itemId,
  skillId,
});

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

describe('assembleDailySet — one skill must not fill the day', () => {
  const skillOf = (items: readonly { skillId: number }[]) => items.map((i) => i.skillId);

  it('takes one item per skill before a second from any of them', () => {
    // The behaviour this replaces: the pool is consumed in id order, so the skills added
    // first fill the whole day and the newest one is never seen at all.
    const set = assembleDailySet(
      pool({
        newCards: [card(1, 10), card(2, 10), card(3, 10), card(4, 20), card(5, 30), card(6, 40)],
      }),
      { cards: 4, questions: 0 },
    );

    expect(skillOf(set).sort()).toEqual([10, 20, 30, 40]);
  });

  it('comes back round for a second item once every skill has had one', () => {
    const set = assembleDailySet(pool({ newCards: [card(1, 10), card(2, 10), card(3, 20)] }), {
      cards: 3,
      questions: 0,
    });

    // Skill 10 gets the first and the third slot; skill 20 the second.
    expect(skillOf(set)).toEqual([10, 20, 10]);
  });

  it('still puts due items before new ones', () => {
    // The spread runs inside each group, not across them: a backlog is reviewed before it
    // grows, and this only changes which overdue items get today's slots.
    const set = assembleDailySet(
      pool({ dueCards: [card(1, 10), card(2, 10)], newCards: [card(3, 20)] }),
      { cards: 3, questions: 0 },
    );

    expect(set.map((i) => i.itemId)).toEqual([1, 2, 3]);
  });

  it('spreads cards and questions independently', () => {
    const set = assembleDailySet(
      pool({
        newCards: [card(1, 10), card(2, 20)],
        newQuestions: [question(3, 10), question(4, 10), question(5, 20)],
      }),
      { cards: 2, questions: 2 },
    );

    expect(skillOf(set.filter((i) => i.itemType === 'card')).sort()).toEqual([10, 20]);
    expect(skillOf(set.filter((i) => i.itemType === 'question')).sort()).toEqual([10, 20]);
  });
});

describe('assembleDailySet — per-skill caps', () => {
  it('never takes more from a skill than its own cap allows', () => {
    const set = assembleDailySet(
      pool({ newCards: [card(1, 10), card(2, 10), card(3, 10), card(4, 20)] }),
      { cards: 4, questions: 0 },
      { cards: new Map([[10, 1]]), questions: new Map() },
    );

    expect(set.filter((i) => i.skillId === 10)).toHaveLength(1);
    expect(set).toHaveLength(2);
  });

  it('treats a cap of zero as "not today", without touching the rest', () => {
    // Parking a skill must not mean deleting it and losing its review history.
    const set = assembleDailySet(
      pool({ newCards: [card(1, 10), card(2, 20), card(3, 30)] }),
      { cards: 3, questions: 0 },
      { cards: new Map([[10, 0]]), questions: new Map() },
    );

    expect(set.map((i) => i.skillId).sort()).toEqual([20, 30]);
  });

  it('gives a capped skill\u2019s slot to another skill rather than spending it on nothing', () => {
    const set = assembleDailySet(
      pool({ newCards: [card(1, 10), card(2, 10), card(3, 20), card(4, 20)] }),
      { cards: 3, questions: 0 },
      { cards: new Map([[10, 1]]), questions: new Map() },
    );

    expect(set).toHaveLength(3);
    expect(set.map((i) => i.skillId).sort()).toEqual([10, 20, 20]);
  });

  it('leaves a skill with no cap of its own alone', () => {
    const set = assembleDailySet(
      pool({ newCards: [card(1, 10), card(2, 20)] }),
      { cards: 2, questions: 0 },
      { cards: new Map([[10, null]]), questions: new Map() },
    );

    expect(set).toHaveLength(2);
  });

  it('applies a cap across due and new items together', () => {
    // The cap limits what the day holds from that skill, not where it came from.
    const set = assembleDailySet(
      pool({ dueCards: [card(1, 10)], newCards: [card(2, 10), card(3, 20)] }),
      { cards: 3, questions: 0 },
      { cards: new Map([[10, 1]]), questions: new Map() },
    );

    expect(set.filter((i) => i.skillId === 10)).toHaveLength(1);
  });
});

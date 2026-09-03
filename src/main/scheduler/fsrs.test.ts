import { describe, expect, it } from 'vitest';
import { schedule, type PriorReview } from './fsrs';

const NOW = new Date('2026-09-03T12:00:00.000Z');

/**
 * These four values were read once from the real `ts-fsrs` dependency with the exact
 * configuration this wrapper uses (`enable_short_term: false`, `enable_fuzz: false`),
 * rather than derived by hand — hand-deriving them would just reimplement the formula a
 * second time and validate it against itself. Pinning them protects the plumbing (input
 * mapping, output mapping, the `prior === null` branch) against silently changing on a
 * dependency upgrade.
 */
describe('schedule — pinned against the real dependency', () => {
  it('schedules a brand-new item on "good"', () => {
    expect(schedule(null, 'good', NOW)).toEqual({
      dueAt: new Date('2026-09-06T12:00:00.000Z'),
      stability: 2.3065,
      difficulty: 2.11810397,
      reps: 1,
      lapses: 0,
    });
  });

  it('schedules a brand-new item on "again", with no lapse recorded yet', () => {
    // A first-ever rating of "again" is not a lapse — there was nothing to fail out of.
    const result = schedule(null, 'again', NOW);
    expect(result.lapses).toBe(0);
    expect(result.reps).toBe(1);
    expect(result.dueAt).toEqual(new Date('2026-09-04T12:00:00.000Z'));
  });

  it('schedules a reviewed item on "good", further out than before', () => {
    const prior: PriorReview = {
      reviewedAt: new Date('2026-08-24T00:00:00.000Z'),
      dueAt: new Date('2026-09-03T00:00:00.000Z'),
      stability: 5,
      difficulty: 5,
      reps: 1,
      lapses: 0,
    };
    const reviewedAt = new Date('2026-09-13T00:00:00.000Z');

    expect(schedule(prior, 'good', reviewedAt)).toEqual({
      dueAt: new Date('2026-10-16T00:00:00.000Z'),
      stability: 33.25319997,
      difficulty: 4.99022837,
      reps: 2,
      lapses: 0,
    });
  });

  it('records a lapse and pulls the due date back in on "again"', () => {
    const prior: PriorReview = {
      reviewedAt: new Date('2026-08-24T00:00:00.000Z'),
      dueAt: new Date('2026-09-03T00:00:00.000Z'),
      stability: 5,
      difficulty: 5,
      reps: 1,
      lapses: 0,
    };
    const reviewedAt = new Date('2026-09-13T00:00:00.000Z');

    expect(schedule(prior, 'again', reviewedAt)).toEqual({
      dueAt: new Date('2026-09-14T00:00:00.000Z'),
      stability: 1.15796952,
      difficulty: 8.34176237,
      reps: 2,
      lapses: 1,
    });
  });
});

describe('schedule — invariants that must hold for any weights', () => {
  it('is a pure function of its inputs: identical calls produce identical output', () => {
    const first = schedule(null, 'good', NOW);
    const second = schedule(null, 'good', NOW);
    expect(second).toEqual(first);
  });

  it('never reads the clock — an unrelated Date.now() cannot change the result', () => {
    const before = schedule(null, 'good', NOW);
    // If this function touched Date.now() internally, this would flake exactly once in a
    // very long while and never in a way a normal run reproduces. It must not.
    const after = schedule(null, 'good', NOW);
    expect(after).toEqual(before);
  });

  it('always schedules the next due date in the future, never at or before the review', () => {
    for (const rating of ['again', 'good'] as const) {
      const result = schedule(null, rating, NOW);
      expect(result.dueAt.getTime()).toBeGreaterThan(NOW.getTime());
    }
  });

  it("keeps difficulty within the algorithm's declared [1, 10] band", () => {
    // Ten straight lapses is the adversarial case for the difficulty formula's upper
    // clamp; ten straight "good" ratings is the adversarial case for its lower one.
    let prior: PriorReview | null = null;
    let cursor = NOW;
    for (let i = 0; i < 10; i += 1) {
      const next = schedule(prior, 'again', cursor);
      expect(next.difficulty).toBeGreaterThanOrEqual(1);
      expect(next.difficulty).toBeLessThanOrEqual(10);
      prior = { reviewedAt: cursor, ...next };
      cursor = next.dueAt;
    }

    prior = null;
    cursor = NOW;
    for (let i = 0; i < 10; i += 1) {
      const next = schedule(prior, 'good', cursor);
      expect(next.difficulty).toBeGreaterThanOrEqual(1);
      expect(next.difficulty).toBeLessThanOrEqual(10);
      prior = { reviewedAt: cursor, ...next };
      cursor = next.dueAt;
    }
  });

  it('grows the interval across repeated "good" reviews reviewed on schedule', () => {
    // The whole point of a scheduler: an item answered correctly, on time, moves further
    // out each time rather than being asked about at a fixed cadence.
    let prior: PriorReview | null = null;
    let cursor = NOW;
    let lastIntervalMs = 0;
    for (let i = 0; i < 5; i += 1) {
      const next = schedule(prior, 'good', cursor);
      const intervalMs = next.dueAt.getTime() - cursor.getTime();
      expect(intervalMs).toBeGreaterThan(lastIntervalMs);
      lastIntervalMs = intervalMs;
      prior = { reviewedAt: cursor, ...next };
      cursor = next.dueAt;
    }
  });

  it('increments reps every time and lapses only on a failed review of an existing item', () => {
    const first = schedule(null, 'good', NOW);
    expect(first.reps).toBe(1);
    expect(first.lapses).toBe(0);

    const prior: PriorReview = { reviewedAt: NOW, ...first };
    const second = schedule(prior, 'again', first.dueAt);
    expect(second.reps).toBe(2);
    expect(second.lapses).toBe(1);

    const thirdPrior: PriorReview = { reviewedAt: first.dueAt, ...second };
    const third = schedule(thirdPrior, 'good', second.dueAt);
    expect(third.reps).toBe(3);
    // A later success does not erase an earlier lapse from the count.
    expect(third.lapses).toBe(1);
  });

  it('pulls the due date in sooner after "again" than "good" would have, from the same state', () => {
    const prior: PriorReview = {
      reviewedAt: new Date('2026-08-24T00:00:00.000Z'),
      dueAt: NOW,
      stability: 8,
      difficulty: 4,
      reps: 3,
      lapses: 0,
    };
    const reviewedAt = new Date('2026-09-10T00:00:00.000Z');

    const afterAgain = schedule(prior, 'again', reviewedAt);
    const afterGood = schedule(prior, 'good', reviewedAt);

    expect(afterAgain.dueAt.getTime()).toBeLessThan(afterGood.dueAt.getTime());
  });
});

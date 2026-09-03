import { describe, expect, it } from 'vitest';
import { endOfLocalDay, localDateString } from './date';

describe('localDateString', () => {
  it('formats year, month and day with zero padding', () => {
    expect(localDateString(new Date(2026, 0, 5, 9, 30))).toBe('2026-01-05');
  });

  it('uses local time, not UTC', () => {
    // 23:30 local on 2026-09-03 is 2026-09-04 in a timezone ahead of UTC by 2h+; the
    // point of this function is that it never cares which — it reads local fields only.
    const date = new Date(2026, 8, 3, 23, 30);
    expect(localDateString(date)).toBe('2026-09-03');
  });
});

describe('endOfLocalDay', () => {
  it('returns the same calendar day, at the last instant', () => {
    const end = endOfLocalDay(new Date(2026, 8, 3, 9, 15));
    expect(localDateString(end)).toBe('2026-09-03');
    expect(end.getHours()).toBe(23);
    expect(end.getMinutes()).toBe(59);
  });

  it('does not mutate the date passed in', () => {
    const original = new Date(2026, 8, 3, 9, 15);
    const originalHours = original.getHours();
    endOfLocalDay(original);
    expect(original.getHours()).toBe(originalHours);
  });

  it('is at or after the input instant, always', () => {
    const now = new Date(2026, 8, 3, 23, 59, 59, 999);
    expect(endOfLocalDay(now).getTime()).toBeGreaterThanOrEqual(now.getTime());
  });
});

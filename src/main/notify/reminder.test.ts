import { describe, expect, it } from 'vitest';
import { isReminderDue } from './reminder';

describe('isReminderDue', () => {
  it('is not due before the configured time', () => {
    const now = new Date(2026, 8, 3, 17, 59);
    expect(isReminderDue(now, '18:00', null)).toBe(false);
  });

  it('is due at the configured time', () => {
    const now = new Date(2026, 8, 3, 18, 0);
    expect(isReminderDue(now, '18:00', null)).toBe(true);
  });

  it('stays due any time after the configured time, not just at the exact minute', () => {
    // The check runs on a periodic timer, not a precise alarm — a missed tick at 18:00
    // must not mean the reminder never fires that day.
    const now = new Date(2026, 8, 3, 22, 30);
    expect(isReminderDue(now, '18:00', null)).toBe(true);
  });

  it('fires only once per day', () => {
    const now = new Date(2026, 8, 3, 20, 0);
    expect(isReminderDue(now, '18:00', '2026-09-03')).toBe(false);
  });

  it('fires again on a new day even at the same clock time', () => {
    const now = new Date(2026, 8, 4, 20, 0);
    expect(isReminderDue(now, '18:00', '2026-09-03')).toBe(true);
  });

  it('rejects a malformed time rather than guessing', () => {
    expect(isReminderDue(new Date(2026, 8, 3, 20, 0), 'not-a-time', null)).toBe(false);
    expect(isReminderDue(new Date(2026, 8, 3, 20, 0), '', null)).toBe(false);
  });

  it('rejects an out-of-range time', () => {
    expect(isReminderDue(new Date(2026, 8, 3, 20, 0), '25:00', null)).toBe(false);
    expect(isReminderDue(new Date(2026, 8, 3, 20, 0), '10:75', null)).toBe(false);
  });
});

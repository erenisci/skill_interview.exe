import { localDateString } from '../util/date';

/**
 * FR-44: a reminder fires at a user-set time, only if today's set is unfinished.
 *
 * Split in two on purpose. This decides *when* — pure, testable with fixed dates, no
 * Electron in sight. Whether today's set actually has anything left undone is a database
 * question the caller answers separately, because pulling that check in here would make
 * the one thing worth unit-testing (the time and once-per-day logic) depend on a live
 * connection to test at all.
 */

/**
 * `lastFiredDate` is the caller's own memory of the last day it fired, kept in the main
 * process rather than in the database — a day the reminder didn't fire (app was closed
 * past the reminder time) simply firing on next launch is the right behaviour, not a bug
 * to guard against with persisted state.
 */
export function isReminderDue(
  now: Date,
  reminderTime: string,
  lastFiredDate: string | null,
): boolean {
  if (lastFiredDate === localDateString(now)) return false;

  const match = /^(\d{1,2}):(\d{2})$/.exec(reminderTime);
  if (!match) return false;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return false;

  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  return nowMinutes >= hours * 60 + minutes;
}

import { Notification } from 'electron';
import type { AppContext } from '../context';
import { localDateString } from '../util/date';
import { log } from '../util/logger';
import { isReminderDue } from './reminder';

/**
 * The only file that knows `Notification` exists — `reminder.ts` decides *when* and is
 * plain, testable logic; this owns the timer and the one Electron call.
 *
 * A minute-resolution `setInterval` rather than a precise alarm scheduled for the exact
 * reminder time: the app is not always running, so nothing can guarantee a callback fires
 * at 18:00:00 sharp. `isReminderDue` is written for exactly this — due at or after the
 * target time, once per day — so a coarse poll is not a compromise, it is the design.
 */

const CHECK_INTERVAL_MS = 60_000;

export interface ReminderDeps extends Pick<AppContext, 'settings' | 'reviews'> {
  readonly now?: () => Date;
}

/** Starts the poll; returns a function that stops it, for a clean shutdown. */
export function startReminder(deps: ReminderDeps, onFire: () => void): () => void {
  const now = deps.now ?? (() => new Date());
  let lastFiredDate: string | null = null;

  const tick = (): void => {
    if (deps.settings.get('reminder_enabled') !== 'true') return;

    const reminderTime = deps.settings.get('reminder_time');
    if (!reminderTime) return;

    const current = now();
    if (!isReminderDue(current, reminderTime, lastFiredDate)) return;

    const today = localDateString(current);
    if (!deps.reviews.hasUnfinished(today)) {
      // Nothing left to do today. Recorded as fired anyway — a finished set must not
      // produce a reminder the moment a new item happens to become due five minutes
      // later; today is done either way.
      lastFiredDate = today;
      return;
    }

    lastFiredDate = today;
    if (!Notification.isSupported()) {
      log.info('notify', 'reminder due but the OS notification centre is unavailable');
      return;
    }
    new Notification({
      title: 'skill_interview.exe',
      body: "Today's set is still waiting.",
    })
      .on('click', onFire)
      .show();
    log.info('notify', 'reminder shown');
  };

  const timer = setInterval(tick, CHECK_INTERVAL_MS);
  return () => clearInterval(timer);
}

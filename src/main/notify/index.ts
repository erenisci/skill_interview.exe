import { app, Menu, Notification, Tray, nativeImage } from 'electron';
import { join } from 'node:path';
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

/**
 * A tray icon whose menu reopens the window, and whose tooltip says whether anything is
 * still due. Kept alive by the returned stop function rather than a module-level variable:
 * an unreferenced Tray is garbage-collected and vanishes from the tray
 * ([TD-16](../../../docs/project/tech-debt.md)).
 */
function createTray(onOpen: () => void, onQuit: () => void): Tray {
  // In development the icon sits in the repository; in a packaged build it is unpacked
  // beside the app, which is what `resources` resolves to at runtime.
  const iconPath = app.isPackaged
    ? join(process.resourcesPath, 'icon.png')
    : join(app.getAppPath(), 'resources', 'icon.png');

  const tray = new Tray(nativeImage.createFromPath(iconPath).resize({ width: 16, height: 16 }));
  tray.setToolTip('skill_interview.exe');
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'Open', click: onOpen },
      { type: 'separator' },
      { label: 'Quit', click: onQuit },
    ]),
  );
  // Clicking the icon itself is what most people try first; the menu is the fallback.
  tray.on('click', onOpen);
  return tray;
}

/** Starts the poll and the tray; returns a function that stops both, for a clean shutdown. */
export function startReminder(
  deps: ReminderDeps,
  onFire: () => void,
  onQuit: () => void,
): () => void {
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

  const tray = createTray(onFire, onQuit);

  // The tooltip is the one always-visible signal that something is waiting, and it is the
  // reason the tray icon earns its place beyond reopening the window.
  const refreshTooltip = (): void => {
    const unfinished = deps.reviews.hasUnfinished(localDateString(now()));
    tray.setToolTip(
      unfinished ? 'skill_interview.exe — today’s set is unfinished' : 'skill_interview.exe',
    );
  };
  refreshTooltip();

  const timer = setInterval(() => {
    refreshTooltip();
    tick();
  }, CHECK_INTERVAL_MS);

  return () => {
    clearInterval(timer);
    tray.destroy();
  };
}

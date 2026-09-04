import type { Db } from '../index';

/**
 * Key-value preferences. Built-in defaults live here so the app runs correctly with
 * nothing configured (docs/operations/configuration.md).
 *
 * `ollama_model` deliberately has no default: choosing a model the user has not pulled
 * produces a confusing failure, whereas unset routes to the setup screen.
 */
export const SETTING_DEFAULTS: Readonly<Record<string, string>> = {
  ollama_url: 'http://localhost:11434',
  // Counts and reminder time were TBD until M-5 needed real numbers to assemble against
  // (docs/operations/configuration.md). 3 cards + 5 questions is a deliberately light
  // daily load — TARGET_QUESTIONS in pipeline/questions.ts already caps a skill at 5, so
  // one skill's full set fills the question side on its own. 18:00 is an ordinary
  // after-work time; there is nothing more principled behind it than that, and it is the
  // first thing to change once real use says otherwise.
  daily_cards: '3',
  daily_questions: '5',
  reminder_enabled: 'true',
  reminder_time: '18:00',
  // On by default because the reminder only exists while the app does: a product whose
  // whole promise is "a small set, every day" cannot deliver it from a process the user
  // closed at lunchtime. The escape hatch is deliberate and two clicks away — Quit in the
  // tray menu, and this setting itself.
  close_to_tray: 'true',
  // Off by default, unlike close-to-tray. Hiding a window the user closed is a small
  // surprise they can undo in a second; adding a program to their machine's startup
  // without being asked is not, and nothing about this product earns that.
  launch_at_startup: 'false',
};

export class SettingsRepository {
  constructor(private readonly db: Db) {}

  get(key: string): string | null {
    const row = this.db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as
      { value: string } | undefined;
    return row?.value ?? SETTING_DEFAULTS[key] ?? null;
  }

  set(key: string, value: string): void {
    this.db
      .prepare(
        `INSERT INTO settings (key, value) VALUES (?, ?)
         ON CONFLICT (key) DO UPDATE SET value = excluded.value`,
      )
      .run(key, value);
  }
}

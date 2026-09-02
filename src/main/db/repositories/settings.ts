import type { Db } from '../index';

/**
 * Key-value preferences. Built-in defaults live here so the app runs correctly with
 * nothing configured (docs/operations/configuration.md).
 *
 * `ollama_model` deliberately has no default: choosing a model the user has not pulled
 * produces a confusing failure, whereas unset routes to the setup screen.
 */
export const SETTING_DEFAULTS: Readonly<Record<string, string>> = {
  content_language: 'en',
  ollama_url: 'http://localhost:11434',
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

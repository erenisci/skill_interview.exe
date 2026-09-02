import type { Database } from 'better-sqlite3';
import { MIGRATIONS } from './migrations';

const VERSION_KEY = 'db_schema_version';

/**
 * The applied version lives in `settings`, but `settings` is itself created by migration 1,
 * so the very first run has nowhere to read from. `user_version` is a SQLite header field
 * that exists before any table does, which makes it the only safe place for the bootstrap.
 * `settings` is kept in step afterwards because docs/operations/configuration.md lists it.
 */
export function currentVersion(db: Database): number {
  const row = db.pragma('user_version', { simple: true });
  return typeof row === 'number' ? row : 0;
}

/**
 * Applies every migration above the current version, each in its own transaction.
 * A failure rolls that migration back and throws — the caller must refuse to start
 * rather than run on a half-migrated database (docs/operations/error-handling.md).
 */
export function migrate(db: Database): number {
  const from = currentVersion(db);
  const pending = MIGRATIONS.filter((m) => m.version > from).sort((a, b) => a.version - b.version);

  for (const migration of pending) {
    const apply = db.transaction(() => {
      db.exec(migration.sql);
      db.pragma(`user_version = ${migration.version}`);
    });

    try {
      apply();
    } catch (cause) {
      const detail = cause instanceof Error ? cause.message : String(cause);
      throw new Error(
        `migration ${migration.version} (${migration.name}) failed and was rolled back: ${detail}`,
        { cause },
      );
    }
  }

  const to = currentVersion(db);
  if (to > 0) {
    db.prepare(
      'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value',
    ).run(VERSION_KEY, String(to));
  }
  return to;
}

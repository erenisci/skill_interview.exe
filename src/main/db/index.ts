import Database from 'better-sqlite3';
import type { Database as Db } from 'better-sqlite3';
import { migrate } from './migrate';

export type { Db };

/**
 * Opens the database and brings it to the current schema version.
 *
 * Pragmas, and why:
 * - `foreign_keys` is OFF by default in SQLite; the schema relies on it for cascades.
 * - `journal_mode = WAL` survives an abrupt process kill without corruption, which the
 *   durable job queue depends on (docs/architecture/system-design.md).
 * - `busy_timeout` covers the brief overlap between a background job writing and the
 *   read path querying.
 */
export function openDatabase(file: string): Db {
  const db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  migrate(db);
  return db;
}

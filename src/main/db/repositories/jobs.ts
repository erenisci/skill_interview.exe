import type { Db } from '../index';
import type { Job, JobKind, JobStatus } from '@shared/domain';

interface JobRow {
  id: number;
  kind: string;
  payload: string;
  status: string;
  attempts: number;
  error: string | null;
  created_at: string;
  updated_at: string;
}

function toJob(row: JobRow): Job {
  return {
    id: row.id,
    kind: row.kind as JobKind,
    payload: row.payload,
    status: row.status as JobStatus,
    attempts: row.attempts,
    error: row.error,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class JobsRepository {
  constructor(private readonly db: Db) {}

  enqueue(kind: JobKind, payload: object, now: string): Job {
    const info = this.db
      .prepare(
        `INSERT INTO jobs (kind, payload, status, attempts, created_at, updated_at)
         VALUES (?, ?, 'pending', 0, ?, ?)`,
      )
      .run(kind, JSON.stringify(payload), now, now);
    const row = this.db.prepare('SELECT * FROM jobs WHERE id = ?').get(info.lastInsertRowid) as
      JobRow | undefined;
    if (!row) throw new Error('job insert did not produce a row');
    return toJob(row);
  }

  claimNext(now: string): Job | null {
    const claim = this.db.transaction((): JobRow | undefined => {
      const row = this.db
        .prepare(
          `SELECT * FROM jobs WHERE status = 'pending' ORDER BY created_at ASC, id ASC LIMIT 1`,
        )
        .get() as JobRow | undefined;
      if (!row) return undefined;
      this.db
        .prepare(
          `UPDATE jobs SET status = 'running', attempts = attempts + 1, updated_at = ? WHERE id = ?`,
        )
        .run(now, row.id);
      return { ...row, status: 'running', attempts: row.attempts + 1, updated_at: now };
    });
    const claimed = claim();
    return claimed ? toJob(claimed) : null;
  }

  finish(id: number, status: Extract<JobStatus, 'done' | 'failed'>, now: string, error?: string) {
    this.db
      .prepare('UPDATE jobs SET status = ?, error = ?, updated_at = ? WHERE id = ?')
      .run(status, error ?? null, now, id);
  }

  /**
   * Rows left in `running` by an abrupt shutdown are reset so the queue resumes.
   * Called once at startup — see docs/architecture/system-design.md.
   */
  resetStale(now: string): number {
    return this.db
      .prepare(`UPDATE jobs SET status = 'pending', updated_at = ? WHERE status = 'running'`)
      .run(now).changes;
  }

  countByStatus(status: JobStatus): number {
    const row = this.db.prepare('SELECT COUNT(*) AS n FROM jobs WHERE status = ?').get(status) as {
      n: number;
    };
    return row.n;
  }
}

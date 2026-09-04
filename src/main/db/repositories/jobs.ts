import type { Job, JobKind, JobStatus } from '@shared/domain';
import type { Db } from '../index';

interface JobRow {
  id: number;
  kind: string;
  payload: string;
  status: string;
  attempts: number;
  error: string | null;
  retry_at: string | null;
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
    retryAt: row.retry_at,
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

  /**
   * Enqueues unless the identical job is already waiting to run.
   *
   * A second copy of a job that has not started yet can do nothing the first will not do,
   * so it is pure duplicated work. This is defence in depth rather than the fix for any
   * one bug: a caller that over-enqueues is a bug in that caller, and one was found —
   * question generation re-woke its neighbours unconditionally and reached 1,098 rows on a
   * real database. But the queue is the place where such a mistake becomes unbounded, so
   * it declines to hold two of the same.
   *
   * `running` and `failed` rows are deliberately not matched: work already in flight may
   * legitimately need doing again with what arrived since, and a failed job is history.
   */
  enqueueUnique(kind: JobKind, payload: object, now: string): Job | null {
    const serialized = JSON.stringify(payload);
    const existing = this.db
      .prepare(
        `SELECT 1 AS present FROM jobs WHERE kind = ? AND payload = ? AND status = 'pending'`,
      )
      .get(kind, serialized) as { present: number } | undefined;
    if (existing) return null;
    return this.enqueue(kind, payload, now);
  }

  /**
   * Takes the oldest job that is due, marking it `running` in the same transaction so a
   * second caller cannot claim it. A job waiting out a backoff (`retry_at` in the future)
   * is skipped rather than blocking the ones behind it.
   */
  claimNext(now: string): Job | null {
    const claim = this.db.transaction((): JobRow | undefined => {
      const row = this.db
        .prepare(
          `SELECT * FROM jobs
           WHERE status = 'pending' AND (retry_at IS NULL OR retry_at <= ?)
           ORDER BY created_at ASC, id ASC
           LIMIT 1`,
        )
        .get(now) as JobRow | undefined;
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

  /** Returns a job to the queue, not to be claimed again before `retryAt`. */
  retryLater(id: number, retryAt: string, now: string, error: string): void {
    this.db
      .prepare(
        `UPDATE jobs SET status = 'pending', retry_at = ?, error = ?, updated_at = ? WHERE id = ?`,
      )
      .run(retryAt, error, now, id);
  }

  /**
   * Rows left in `running` by an abrupt shutdown are reset so the queue resumes.
   * Called once at startup — see docs/architecture/system-design.md.
   */
  resetStale(now: string): number {
    return this.db
      .prepare(
        `UPDATE jobs SET status = 'pending', retry_at = NULL, updated_at = ? WHERE status = 'running'`,
      )
      .run(now).changes;
  }

  findById(id: number): Job | null {
    const row = this.db.prepare('SELECT * FROM jobs WHERE id = ?').get(id) as JobRow | undefined;
    return row ? toJob(row) : null;
  }

  /**
   * Why this skill's work gave up, for the screen to show.
   *
   * A red `failed` badge with no reason is indistinguishable from a broken app, and the
   * reason here is genuinely actionable — "none of the 4 name-matching candidates is about
   * Java" tells the user their skill needs a more specific name, which nothing else does.
   *
   * Matched on the payload rather than a column, because a job's link to its skill lives
   * in its payload. The pattern carries the closing brace so that it is bounded on both
   * sides — without it, skill 1 would match every `{"skillId":1x}` there is.
   */
  lastFailureFor(skillId: number): string | null {
    const row = this.db
      .prepare(
        `SELECT error FROM jobs
         WHERE status = 'failed' AND payload LIKE ? AND error IS NOT NULL
         ORDER BY id DESC LIMIT 1`,
      )
      .get(`%"skillId":${String(skillId)}}%`) as { error: string } | undefined;
    return row?.error ?? null;
  }

  /**
   * Drops every job belonging to a skill, whatever its state.
   *
   * Jobs carry no foreign key — a job's link to its skill lives in a JSON payload — so
   * nothing cascades on deletion, and one real database ended up holding 1,098 rows for
   * skills that no longer existed. Failed rows go too: their stored reason is only useful
   * on the skill's own row, which is gone.
   */
  deleteForSkill(skillId: number): number {
    return this.db.prepare('DELETE FROM jobs WHERE payload LIKE ?').run(
      // Bounded on both sides, or skill 1 would take 10 through 19 with it.
      `%"skillId":${String(skillId)}}%`,
    ).changes;
  }

  countByStatus(status: JobStatus): number {
    const row = this.db.prepare('SELECT COUNT(*) AS n FROM jobs WHERE status = ?').get(status) as {
      n: number;
    };
    return row.n;
  }
}

-- A `classify` job kind, and a clear-out for jobs whose skill is gone.
--
-- Why the table is rebuilt rather than altered: `jobs.kind` carries a CHECK constraint, and
-- SQLite cannot modify one in place. The twelve-step ALTER TABLE procedure is the supported
-- way, and this is the short version of it — new table, copy, drop, rename — run inside the
-- transaction `migrate()` already wraps every migration in.
--
-- The `classify` kind exists because a skill whose classification failed was stranded for
-- good: it kept its card, which is right, but nothing ever tried again, so it had no
-- neighbours, no comparison cards and the worst possible distractor pool for as long as it
-- existed. Research now queues a retry, and the queue's backoff and attempt limit apply.

CREATE TABLE jobs_new (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  kind       TEXT    NOT NULL
                     CHECK (kind IN ('research', 'classify', 'compare', 'generate-questions')),
  payload    TEXT    NOT NULL,
  status     TEXT    NOT NULL DEFAULT 'pending'
                     CHECK (status IN ('pending', 'running', 'done', 'failed')),
  attempts   INTEGER NOT NULL DEFAULT 0,
  error      TEXT,
  retry_at   TEXT,
  created_at TEXT    NOT NULL,
  updated_at TEXT    NOT NULL
);

INSERT INTO jobs_new (id, kind, payload, status, attempts, error, retry_at, created_at, updated_at)
SELECT id, kind, payload, status, attempts, error, retry_at, created_at, updated_at FROM jobs;

DROP TABLE jobs;
ALTER TABLE jobs_new RENAME TO jobs;

CREATE INDEX idx_jobs_pickup ON jobs (status, retry_at, created_at);

-- Jobs left behind by skills that no longer exist. On one real database every skill had been
-- deleted and 1,098 rows remained, all pointing at ids that were gone. Handlers already
-- no-op on a missing skill, so this was storage and log noise rather than incorrectness —
-- but a queue that only ever grows is the wrong shape, and deletion now clears its own.
DELETE FROM jobs
WHERE payload LIKE '{"skillId":%'
  AND CAST(replace(replace(payload, '{"skillId":', ''), '}', '') AS INTEGER)
      NOT IN (SELECT id FROM skills);

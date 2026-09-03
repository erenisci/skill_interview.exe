-- 002 job retry scheduling
-- A failed-but-retryable job must not be re-claimed immediately: without a "not before"
-- time the loop either spins on it or blocks the whole queue for the backoff. Storing it
-- keeps the backoff across restarts, which an in-memory timer would lose.

ALTER TABLE jobs ADD COLUMN retry_at TEXT;

DROP INDEX idx_jobs_pickup;

CREATE INDEX idx_jobs_pickup ON jobs (status, retry_at, created_at);

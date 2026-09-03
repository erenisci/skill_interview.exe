-- The daily set (M-5).
--
-- Why this is a table and not a live query. FR-43 requires that closing and reopening the
-- app resumes the same day: assembling fresh from `reviews` on every open would let a set
-- drift mid-day as items become newly due, so a set is assembled once per local day and
-- frozen. Membership (which item ids belong to today) is frozen at that point; `position`
-- records the order they were assembled in so the UI is stable across reopens too.
--
-- Content is not frozen. A question flagged after assembly must still disappear from an
-- already-assembled set — the read path joins against the live `questions.status`, this
-- table only decides which ids are in play for the day.
CREATE TABLE daily_set_items (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  -- Local calendar date (YYYY-MM-DD), computed once by the caller — this table has no
  -- opinion about timezones (docs/architecture/system-design.md).
  set_date     TEXT    NOT NULL,
  item_type    TEXT    NOT NULL CHECK (item_type IN ('card', 'question')),
  item_id      INTEGER NOT NULL,
  position     INTEGER NOT NULL,
  -- Null until answered/acknowledged. Distinct from FSRS's `reviews` row for the same
  -- event: this marks the item done *for today's set*, that one carries the schedule.
  completed_at TEXT
);

-- One row per item per day; assembly is checked with this before it ever runs.
CREATE UNIQUE INDEX idx_daily_set_items_unique ON daily_set_items (set_date, item_type, item_id);

-- The read path's only query: today's set, in assembly order.
CREATE INDEX idx_daily_set_items_date ON daily_set_items (set_date, position);

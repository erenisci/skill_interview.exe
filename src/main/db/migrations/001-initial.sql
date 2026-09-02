-- 001 initial schema
-- Mirrors docs/architecture/database-design.md. Forward-only: never edit after release.

CREATE TABLE skills (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  name         TEXT    NOT NULL,
  slug         TEXT    NOT NULL UNIQUE,
  category     TEXT,
  tags         TEXT    NOT NULL DEFAULT '[]',
  status       TEXT    NOT NULL DEFAULT 'pending'
                       CHECK (status IN ('pending', 'researching', 'ready', 'failed')),
  content_lang TEXT    NOT NULL CHECK (content_lang IN ('en', 'tr')),
  created_at   TEXT    NOT NULL
);

-- Each pair stored once, with skill_a_id < skill_b_id.
CREATE TABLE skill_relations (
  skill_a_id INTEGER NOT NULL REFERENCES skills (id) ON DELETE CASCADE,
  skill_b_id INTEGER NOT NULL REFERENCES skills (id) ON DELETE CASCADE,
  kind       TEXT    NOT NULL CHECK (kind IN ('same-category', 'tag-overlap')),
  strength   REAL    NOT NULL,
  PRIMARY KEY (skill_a_id, skill_b_id),
  CHECK (skill_a_id < skill_b_id)
);

-- `excerpt` is the text the model actually saw. Without it, "grounded or invented?"
-- is unanswerable after the fact.
CREATE TABLE sources (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  skill_id   INTEGER NOT NULL REFERENCES skills (id) ON DELETE CASCADE,
  url        TEXT    NOT NULL,
  title      TEXT    NOT NULL,
  publisher  TEXT,
  license    TEXT,
  fetched_at TEXT    NOT NULL,
  excerpt    TEXT    NOT NULL
);

CREATE TABLE cards (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  skill_id          INTEGER NOT NULL REFERENCES skills (id) ON DELETE CASCADE,
  related_skill_id  INTEGER REFERENCES skills (id) ON DELETE CASCADE,
  type              TEXT    NOT NULL CHECK (type IN ('primer', 'comparison')),
  title             TEXT    NOT NULL,
  body_md           TEXT    NOT NULL,
  content_lang      TEXT    NOT NULL CHECK (content_lang IN ('en', 'tr')),
  model             TEXT    NOT NULL,
  prompt_version    TEXT    NOT NULL,
  created_at        TEXT    NOT NULL,
  CHECK ((type = 'comparison') = (related_skill_id IS NOT NULL))
);

-- A card with no row here is a bug: every card must carry its provenance.
CREATE TABLE card_sources (
  card_id   INTEGER NOT NULL REFERENCES cards (id) ON DELETE CASCADE,
  source_id INTEGER NOT NULL REFERENCES sources (id) ON DELETE CASCADE,
  PRIMARY KEY (card_id, source_id)
);

CREATE TABLE questions (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  skill_id       INTEGER NOT NULL REFERENCES skills (id) ON DELETE CASCADE,
  card_id        INTEGER NOT NULL REFERENCES cards (id) ON DELETE CASCADE,
  stem           TEXT    NOT NULL,
  explanation    TEXT    NOT NULL,
  difficulty     TEXT,
  content_lang   TEXT    NOT NULL CHECK (content_lang IN ('en', 'tr')),
  model          TEXT    NOT NULL,
  prompt_version TEXT    NOT NULL,
  status         TEXT    NOT NULL DEFAULT 'active'
                         CHECK (status IN ('active', 'rejected', 'flagged'))
);

-- Exactly four rows per question, exactly one with is_correct = 1. Enforced in code:
-- SQLite cannot express it, and the validator records *why* a candidate was rejected.
CREATE TABLE options (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  question_id     INTEGER NOT NULL REFERENCES questions (id) ON DELETE CASCADE,
  text            TEXT    NOT NULL,
  rationale       TEXT    NOT NULL,
  is_correct      INTEGER NOT NULL DEFAULT 0 CHECK (is_correct IN (0, 1)),
  source_skill_id INTEGER REFERENCES skills (id) ON DELETE SET NULL
);

-- Polymorphic on purpose: deleting a skill must not cascade away review history.
CREATE TABLE reviews (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  item_type   TEXT    NOT NULL CHECK (item_type IN ('card', 'question')),
  item_id     INTEGER NOT NULL,
  reviewed_at TEXT    NOT NULL,
  rating      INTEGER NOT NULL,
  due_at      TEXT    NOT NULL,
  stability   REAL    NOT NULL,
  difficulty  REAL    NOT NULL,
  reps        INTEGER NOT NULL DEFAULT 0,
  lapses      INTEGER NOT NULL DEFAULT 0
);

-- A favourite outlives its skill; the UI marks it orphaned rather than deleting it.
CREATE TABLE favorites (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  item_type  TEXT    NOT NULL CHECK (item_type IN ('card', 'question')),
  item_id    INTEGER NOT NULL,
  note       TEXT,
  created_at TEXT    NOT NULL
);

-- The durable queue. Status lives here so a crash mid-job is recoverable.
CREATE TABLE jobs (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  kind       TEXT    NOT NULL CHECK (kind IN ('research', 'compare', 'generate-questions')),
  payload    TEXT    NOT NULL,
  status     TEXT    NOT NULL DEFAULT 'pending'
                     CHECK (status IN ('pending', 'running', 'done', 'failed')),
  attempts   INTEGER NOT NULL DEFAULT 0,
  error      TEXT,
  created_at TEXT    NOT NULL,
  updated_at TEXT    NOT NULL
);

CREATE TABLE settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE INDEX idx_reviews_due   ON reviews (item_type, item_id, due_at);
CREATE INDEX idx_jobs_pickup   ON jobs (status, created_at);
CREATE INDEX idx_cards_skill   ON cards (skill_id, type);
CREATE INDEX idx_options_q     ON options (question_id);
CREATE INDEX idx_sources_skill ON sources (skill_id);

CREATE VIRTUAL TABLE cards_fts USING fts5 (
  title,
  body_md,
  content = 'cards',
  content_rowid = 'id'
);

CREATE TRIGGER cards_ai AFTER INSERT ON cards BEGIN
  INSERT INTO cards_fts (rowid, title, body_md) VALUES (new.id, new.title, new.body_md);
END;

CREATE TRIGGER cards_ad AFTER DELETE ON cards BEGIN
  INSERT INTO cards_fts (cards_fts, rowid, title, body_md)
  VALUES ('delete', old.id, old.title, old.body_md);
END;

CREATE TRIGGER cards_au AFTER UPDATE ON cards BEGIN
  INSERT INTO cards_fts (cards_fts, rowid, title, body_md)
  VALUES ('delete', old.id, old.title, old.body_md);
  INSERT INTO cards_fts (rowid, title, body_md) VALUES (new.id, new.title, new.body_md);
END;

---
title: Database Design
discipline: code
status: active
updated: 2026-09-02
---

# Database Design

> **Purpose.** The schema, why it is shaped this way, and how it changes over time.
> **Related.** [erd.md](erd.md) · [system-design.md](system-design.md)

One SQLite file at `%APPDATA%/skill-interview/skills.db`. It is the only durable state in the product; deleting it
is a clean reset, not a corruption.

## Connection Pragmas

Set on every open, in `src/main/db/index.ts`. None of them are defaults, and each is load-bearing:

| Pragma                | Why                                                                                                                       |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `foreign_keys = ON`   | Off by default in SQLite. The schema's cascades — and the deliberate _lack_ of one on `reviews` — mean nothing without it |
| `journal_mode = WAL`  | Survives an abrupt process kill without corruption, which the durable job queue depends on                                |
| `busy_timeout = 5000` | Covers the overlap between a background job writing and the read path querying                                            |

## Data Model

Five groups of tables:

| Group      | Tables                          | Role                                              |
| ---------- | ------------------------------- | ------------------------------------------------- |
| Knowledge  | `skills`, `skill_relations`     | What the user claims to know, and how it connects |
| Provenance | `sources`, `card_sources`       | Where every generated claim came from             |
| Content    | `cards`, `questions`, `options` | The generated material                            |
| Learning   | `reviews`, `favorites`          | What the user has done with it                    |
| Machinery  | `jobs`, `settings`              | Background work and preferences                   |

Two rules shape the whole schema:

1. **Nothing generated exists without provenance.** A card without a source row is a bug, not an edge case.
2. **Every generated row records `model` and `prompt_version`.** Without them a quality regression cannot be
   attributed, and the eval harness has nothing to compare.

## Tables

### `skills`

| Column         | Type        | Notes                                          |
| -------------- | ----------- | ---------------------------------------------- |
| `id`           | INTEGER PK  |                                                |
| `name`         | TEXT        | As the user typed it                           |
| `slug`         | TEXT UNIQUE | Normalized; the duplicate-detection key        |
| `category`     | TEXT        | Assigned during research; user-correctable     |
| `tags`         | TEXT        | JSON array                                     |
| `status`       | TEXT        | `pending` · `researching` · `ready` · `failed` |
| `content_lang` | TEXT        | Language its content was generated in          |
| `created_at`   | TEXT        | ISO-8601                                       |

### `skill_relations`

| Column                      | Type       | Notes                                                          |
| --------------------------- | ---------- | -------------------------------------------------------------- |
| `skill_a_id` / `skill_b_id` | INTEGER FK | Stored with `a < b` so each pair appears once                  |
| `kind`                      | TEXT       | `same-category` · `tag-overlap`                                |
| `strength`                  | REAL       | Gates comparison generation; weak relations do not earn a card |

PK `(skill_a_id, skill_b_id)`. Recomputed when a skill is added, deleted, or reclassified.

### `sources`

| Column                      | Type       | Notes                                          |
| --------------------------- | ---------- | ---------------------------------------------- |
| `id`                        | INTEGER PK |                                                |
| `skill_id`                  | INTEGER FK |                                                |
| `url`, `title`, `publisher` | TEXT       |                                                |
| `license`                   | TEXT       | Needed for attribution — Wikipedia is CC BY-SA |
| `fetched_at`                | TEXT       |                                                |
| `excerpt`                   | TEXT       | Extracted text the model actually saw          |

`excerpt` is kept deliberately: without it, "was this grounded or invented?" is unanswerable after the fact.

### `cards`

| Column                                    | Type            | Notes                    |
| ----------------------------------------- | --------------- | ------------------------ |
| `id`                                      | INTEGER PK      |                          |
| `skill_id`                                | INTEGER FK      | Primary skill            |
| `related_skill_id`                        | INTEGER FK NULL | Set for comparison cards |
| `type`                                    | TEXT            | `primer` · `comparison`  |
| `title`, `body_md`                        | TEXT            |                          |
| `content_lang`, `model`, `prompt_version` | TEXT            |                          |
| `created_at`                              | TEXT            |                          |

`card_sources(card_id, source_id)` joins cards to their provenance.

### `questions` and `options`

| `questions` column                        | Type       | Notes                             |
| ----------------------------------------- | ---------- | --------------------------------- |
| `id`                                      | INTEGER PK |                                   |
| `skill_id`, `card_id`                     | INTEGER FK |                                   |
| `stem`, `explanation`                     | TEXT       |                                   |
| `difficulty`                              | TEXT       |                                   |
| `content_lang`, `model`, `prompt_version` | TEXT       |                                   |
| `status`                                  | TEXT       | `active` · `rejected` · `flagged` |

| `options` column    | Type            | Notes                                                                     |
| ------------------- | --------------- | ------------------------------------------------------------------------- |
| `id`                | INTEGER PK      |                                                                           |
| `question_id`       | INTEGER FK      |                                                                           |
| `text`, `rationale` | TEXT            | Every option carries a rationale, including wrong ones                    |
| `is_correct`        | INTEGER         | Exactly one per question — enforced in code, not by a constraint          |
| `source_skill_id`   | INTEGER FK NULL | Which sibling skill this distractor came from; NULL means model-generated |

`source_skill_id` is what lets the eval harness measure whether sibling distractors beat model-generated ones.

### `reviews`

| Column                    | Type       | Notes               |
| ------------------------- | ---------- | ------------------- |
| `id`                      | INTEGER PK |                     |
| `item_type`               | TEXT       | `card` · `question` |
| `item_id`                 | INTEGER    |                     |
| `reviewed_at`             | TEXT       |                     |
| `rating`                  | INTEGER    |                     |
| `due_at`                  | TEXT       |                     |
| `stability`, `difficulty` | REAL       | FSRS state          |
| `reps`, `lapses`          | INTEGER    |                     |

The fastest-growing table. Append-only.

### `favorites`, `jobs`, `settings`

`favorites(id, item_type, item_id, note, created_at)` — survives deletion of its skill, with a marker.

`jobs(id, kind, payload, status, attempts, error, created_at, updated_at)` — the durable queue. `status` is
`pending` · `running` · `done` · `failed`; rows stuck in `running` past a timeout are reset at startup.

`settings(key, value)` — content language, daily counts, reminder time, model choice, Ollama URL, optional search key.

## Indexes

| Index                                 | Why                                      |
| ------------------------------------- | ---------------------------------------- |
| `skills(slug)` UNIQUE                 | Duplicate detection on every add         |
| `reviews(item_type, item_id, due_at)` | The daily-set query; must not table-scan |
| `jobs(status, created_at)`            | Queue pickup                             |
| `cards(skill_id, type)`               | Card lookup per skill                    |
| `options(question_id)`                | Always fetched with its question         |
| FTS5 over `cards(title, body_md)`     | User-facing search                       |

## Migrations

Forward-only, ordered, one file per migration in `src/main/db/migrations/`, each imported as raw SQL and applied at
startup inside its own transaction. A failure rolls that migration back and throws, and the app refuses to start
rather than run on a half-migrated database.

**Where the version lives.** The authoritative value is SQLite's `user_version` header field, not `settings`.
`settings` is itself created by migration 1, so on a first run there is no table to read from — the bootstrap has to
sit somewhere that exists before any table does. `settings.db_schema_version` is written afterwards and kept in step,
because [../operations/configuration.md](../operations/configuration.md) lists it and it is the easier one to inspect.

## Constraints in the schema

Some invariants are cheap for SQLite to enforce, and those are declared rather than left to code:

| Constraint                                                       | Guards                                                                              |
| ---------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `skills.slug` UNIQUE                                             | Duplicate detection (FR-02) even if the check above it is bypassed                  |
| `CHECK ((type = 'comparison') = (related_skill_id IS NOT NULL))` | A comparison card must name two skills; a primer must not                           |
| `CHECK (skill_a_id < skill_b_id)` + composite PK                 | Each relation pair stored exactly once, in one direction                            |
| `CHECK (is_correct IN (0, 1))`                                   | An option is correct or it is not                                                   |
| `CHECK` on every status and enum column                          | Keeps stored values identical to the TypeScript unions                              |
| `ON DELETE CASCADE` from `skills`                                | Deleting a skill takes its cards, sources, questions, and relations                 |
| No foreign key on `reviews` / `favorites`                        | Deliberate: deleting a skill must **not** erase review history or a saved favourite |

**The question invariants are not here.** Exactly four options with exactly one correct answer cannot be expressed as
a table constraint, and enforcing it in code is the better place anyway — the validator records _why_ a candidate was
rejected, which is the signal the quality metrics need ([../llm/guardrails.md](../llm/guardrails.md)).

No down-migrations. On a single-user desktop app they are more likely to destroy data than to save it; the recovery
path is reinstalling the previous version, which is why [../project/release-plan.md](../project/release-plan.md)
requires testing an upgrade over a populated database before every release.

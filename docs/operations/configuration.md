---
title: Configuration
discipline: ops
status: active
updated: 2026-09-02
---

# Configuration

> **Purpose.** Every setting, its default, and how a value is resolved.
> **Related.** [env-vars.md](env-vars.md) · [../product/feature-specs.md](../product/feature-specs.md)

## Config Sources

Three, in a deliberate order:

1. **Built-in defaults** — compiled in. The app must run correctly with nothing configured.
2. **The `settings` table** — the user's choices, stored locally, edited only through the settings UI.
3. **Development environment variables** — tooling only, never used in a packaged build
   ([env-vars.md](env-vars.md)).

There is no configuration file the user edits by hand. A desktop app that requires editing JSON to work has failed at
onboarding, and a hand-edited file is also a place for a key to leak.

## Precedence

```text
built-in default  ◀──overridden by──  settings table  ◀──overridden by──  dev env vars (dev only)
```

An unset setting falls back to its default rather than erroring. A setting whose value has become invalid — a model
removed from Ollama, for instance — is reported in the settings UI as an error on that field, and the app keeps
running on the default where one is possible.

## Settings

| Key                 | Default                  | Meaning                                                                           |
| ------------------- | ------------------------ | --------------------------------------------------------------------------------- |
| `content_language`  | `en`                     | Language new cards and questions are generated in. Applies to new generation only |
| `daily_cards`       | `3`                      | How many cards per day                                                            |
| `daily_questions`   | `5`                      | How many questions per day                                                        |
| `reminder_enabled`  | `true`                   | Whether the reminder notification fires                                           |
| `reminder_time`     | `18:00`                  | Local `HH:MM`, 24-hour, for the reminder                                          |
| `ollama_url`        | `http://localhost:11434` | Where Ollama is reached                                                           |
| `ollama_model`      | unset                    | Chosen from Ollama's installed list; no default is invented                       |
| `search_provider`   | `default`                | `default` (GitHub + docs + Wikipedia) or `tavily` / `brave`                       |
| `search_api_key`    | unset                    | User's own key. Local only, never logged or exported                              |
| `db_schema_version` | set by migrations        | Applied migration version; not user-editable                                      |

**`daily_cards`, `daily_questions` and `reminder_time` were TBD until M-5 built the scheduler that needed real
numbers.** They are deliberate but not evidence-based — `daily_questions: 5` matches `TARGET_QUESTIONS` in
`pipeline/questions.ts`, so a single researched skill's full question set fills the day on its own; `18:00` is an
ordinary after-work hour with no study behind it. First candidates to revisit once real use — the app is public, not
gated behind a private trial ([roadmap.md, M-9](../project/roadmap.md)) — has an opinion
([`src/main/db/repositories/settings.ts`](../../src/main/db/repositories/settings.ts)).

**`ollama_model` has no default on purpose.** Picking a model the user has not pulled produces a confusing failure;
an unset value routes to the setup screen, which is the correct behaviour.

## Per-Environment

There is no server, so "environment" means build configuration only:

|             | dev                                              | release                                    |
| ----------- | ------------------------------------------------ | ------------------------------------------ |
| Database    | project directory, or `SKILL_INTERVIEW_DATA_DIR` | `%APPDATA%/skill-interview/skills.db`      |
| Logging     | verbose, to console                              | normal, to file ([logging.md](logging.md)) |
| DevTools    | available                                        | disabled                                   |
| Source maps | on                                               | off                                        |

Settings themselves do not differ between environments. The same table, the same defaults — so a bug reproduced in
development is the same bug the user has.

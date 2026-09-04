---
title: Configuration
discipline: ops
status: active
updated: 2026-09-04
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
| `github_token`      | unset                    | User's own GitHub token. Raises the search rate limit only; never required        |
| `db_schema_version` | set by migrations        | Applied migration version; not user-editable                                      |

**`github_token` is the only credential the app can hold**, and it is optional in the strong sense: research works
without one, because an open-source project cannot ship a key. It raises GitHub's unauthenticated 60 req/h to 5000.
It is stored locally, never logged, and never included in an export ([security.md](security.md)).

A `tavily` / `brave` search provider is discussed as a possible upgrade in
[../llm/rag-sources.md](../llm/rag-sources.md) but **is not built**, and there is deliberately no setting for one
here — the settings table lists what the app reads, not what it might read one day.

**`daily_cards`, `daily_questions` and `reminder_time` were TBD until M-5 built the scheduler that needed real
numbers.** They are deliberate but not evidence-based — `daily_questions: 5` matches `TARGET_QUESTIONS` in
`pipeline/questions.ts`, so a single researched skill's full question set fills the day on its own; `18:00` is an
ordinary after-work hour with no study behind it. First candidates to revisit once real use has an opinion — the app
is public rather than gated behind a private trial ([roadmap.md, M-9](../project/roadmap.md))
([`src/main/db/repositories/settings.ts`](../../src/main/db/repositories/settings.ts)).

**`ollama_model` has no default on purpose.** Picking a model the user has not pulled produces a confusing failure;
an unset value routes to the setup screen, which is the correct behaviour.

## Validation

Every write goes through `validateSetting()`
([`src/main/util/settings-validation.ts`](../../src/main/util/settings-validation.ts)) before it reaches the table.
This is load-bearing rather than polish: a `reminder_time` the reminder cannot parse makes it return "not due"
forever, and nothing on screen would say why.

| Key                                  | Accepted                                   | Normalised                |
| ------------------------------------ | ------------------------------------------ | ------------------------- |
| `daily_cards`, `daily_questions`     | A whole number, 0–50. Empty is **refused** | Trimmed                   |
| `reminder_time`                      | 24-hour `H:MM` or `HH:MM`                  | Zero-padded to `HH:MM`    |
| `reminder_enabled`                   | `true` / `false`                           | —                         |
| `content_language`                   | `en` / `tr`                                | —                         |
| `ollama_url`                         | A parseable `http:` or `https:` URL        | Trailing slashes stripped |
| Anything else (incl. `github_token`) | Passes through                             | Trimmed                   |

Zero is a legitimate count — a user who wants only questions sets `daily_cards` to 0 deliberately. An **empty** field
is not: `Number('')` is 0, so accepting it would silently mean "nothing today" rather than being refused.

Unknown keys pass through on purpose. This guards what the app reads; it is not a registry of everything it may store.
A refusal keeps the stored value and names the field, and the settings screen reloads from storage rather than leaving
an invalid value on screen looking accepted.

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

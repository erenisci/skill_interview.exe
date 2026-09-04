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

| Key                 | Default                  | Meaning                                                                    |
| ------------------- | ------------------------ | -------------------------------------------------------------------------- |
| `reminder_enabled`  | `true`                   | Whether the reminder notification fires                                    |
| `reminder_time`     | `18:00`                  | Local `HH:MM`, 24-hour, for the reminder                                   |
| `close_to_tray`     | `true`                   | Closing the window hides it in the tray instead of quitting                |
| `launch_at_startup` | `false`                  | Register a Windows login item; packaged builds only                        |
| `ollama_url`        | `http://localhost:11434` | Where Ollama is reached                                                    |
| `ollama_model`      | unset                    | Chosen from Ollama's installed list; no default is invented                |
| `github_token`      | unset                    | User's own GitHub token. Raises the search rate limit only; never required |
| `db_schema_version` | set by migrations        | Applied migration version; not user-editable                               |

**`content_language` is gone.** The product is English-only ([../product/prd.md](../product/prd.md)): Turkish was
supported, measured, and withdrawn, so a setting offering a choice that does not exist would be a lie in a table
whose whole job is to be true.

**`github_token` is the only credential the app can hold**, and it is optional in the strong sense: research works
without one, because an open-source project cannot ship a key. It raises GitHub's unauthenticated 60 req/h to 5000.
It is stored locally, never logged, and never included in an export ([security.md](security.md)).

A `tavily` / `brave` search provider is discussed as a possible upgrade in
[../llm/rag-sources.md](../llm/rag-sources.md) but **is not built**, and there is deliberately no setting for one
here — the settings table lists what the app reads, not what it might read one day.

**There is no global "cards per day" any more.** A day is summed from what each skill contributes, because a single
number divided among skills makes every skill added shrink every skill already there — which is backwards. Adding a
skill should mean more to read tomorrow. See **Per-skill limits** below.

`reminder_time` is deliberate but not evidence-based: `18:00` is an ordinary after-work hour with no study behind it,
and the first candidate to revisit once real use has an opinion.

**`close_to_tray` defaults to on**, which is the one default here that overrides an OS convention, so it earns a
reason. The reminder is the product's only mechanism for making this a daily habit, and a notification at 18:00
needs a process at 18:00 — an app quit at lunchtime cannot deliver the thing it promises. The cost is the familiar
annoyance of software that will not close, so the escape hatches are deliberate and both obvious: **Quit** in the
tray icon's menu, and the setting itself. The window is hidden rather than destroyed, so reopening is instant.

**`launch_at_startup` is off by default, and `close_to_tray` is on** — the difference is deliberate. Hiding a window
someone closed is a small surprise they can undo in a second. Adding a program to their machine's startup without
being asked is not, and nothing about this product earns that. It applies to packaged builds only: in development the
executable is Electron's own binary inside `node_modules`, and registering _that_ at login would be an unpleasant
thing to leave on a contributor's machine. A login launch passes `--hidden` and goes straight to the tray.

**`ollama_model` has no default on purpose.** Picking a model the user has not pulled produces a confusing failure;
an unset value routes to the setup screen, which is the correct behaviour.

## Per-skill limits

A day is what the user's skills add up to. Each skill contributes `PER_SKILL_DEFAULTS` — one card and two questions —
unless it says otherwise on its own page, so four skills is a six-item day and adding a fifth makes tomorrow bigger
rather than thinner.

The set is also laid out **one item per skill before a second from any of them**. Assembly used to take whatever the
pool offered first, which in id order meant the earliest-added skills filled the whole day and the newest were never
seen at all.

| Column                   | Blank (`NULL`)                          | `0`                         | `n`                         |
| ------------------------ | --------------------------------------- | --------------------------- | --------------------------- |
| `skills.daily_cards`     | Contributes the default — one card      | Not today — parks the skill | At most `n` cards today     |
| `skills.daily_questions` | Contributes the default — two questions | Same                        | At most `n` questions today |

`0` exists so a skill can be paused without deleting it, which would take its review history with it.

## Validation

Every write goes through `validateSetting()`
([`src/main/util/settings-validation.ts`](../../src/main/util/settings-validation.ts)) before it reaches the table.
This is load-bearing rather than polish: a `reminder_time` the reminder cannot parse makes it return "not due"
forever, and nothing on screen would say why.

| Key                                                      | Accepted                            | Normalised                |
| -------------------------------------------------------- | ----------------------------------- | ------------------------- |
| `reminder_time`                                          | 24-hour `H:MM` or `HH:MM`           | Zero-padded to `HH:MM`    |
| `reminder_enabled`, `close_to_tray`, `launch_at_startup` | `true` / `false`                    | —                         |
| `ollama_url`                                             | A parseable `http:` or `https:` URL | Trailing slashes stripped |
| Anything else (incl. `github_token`)                     | Passes through                      | Trimmed                   |

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

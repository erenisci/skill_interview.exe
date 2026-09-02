---
title: Environment Variables
discipline: ops
status: active
updated: 2026-09-02
---

# Environment Variables

> **Purpose.** Every environment variable, what it is for, and where real configuration actually lives.
> **Related.** [configuration.md](configuration.md) · [security.md](security.md)

**This app is not configured by environment variables.** It is a desktop application with no server and no deployment
environment. User-facing configuration lives in the `settings` table and is edited in the app's settings UI
([configuration.md](configuration.md)).

Environment variables exist only for development and build tooling. **A user never sets one.**

## Variables

| Name                       | Purpose                                                                                      | Required                                         | Example                                   |
| -------------------------- | -------------------------------------------------------------------------------------------- | ------------------------------------------------ | ----------------------------------------- |
| `NODE_ENV`                 | Build mode; controls logging verbosity and devtools                                          | No — defaults to `production` in packaged builds | `development`                             |
| `SKILL_INTERVIEW_DATA_DIR` | Override the database location. Development and testing only                                 | No — defaults to `%APPDATA%/skill-interview/`    | `./.dev-data`                             |
| `OLLAMA_HOST`              | Read by Ollama itself, not by this app. Documented because it explains a common support case | No                                               | `http://localhost:11434`                  |
| `ELECTRON_MIRROR`          | Alternate download mirror for Electron binaries during `npm install`                         | No                                               | `https://npmmirror.com/mirrors/electron/` |

`SKILL_INTERVIEW_DATA_DIR` is **not wired up yet** — the database currently always lives under Electron's `userData`
path. It is listed here because it is planned, not because it works; see Next Up in [../progress.md](../progress.md).

There is **no `.env` file** in this project and none should be added. If one appears, something has been designed the
wrong way — see below.

## Where configuration actually lives

| Setting                         | Stored in                        | Set by      |
| ------------------------------- | -------------------------------- | ----------- |
| Content language                | `settings` table                 | Settings UI |
| Daily card and question counts  | `settings` table                 | Settings UI |
| Reminder time                   | `settings` table                 | Settings UI |
| Selected Ollama model           | `settings` table                 | Settings UI |
| Ollama URL                      | `settings` table                 | Settings UI |
| Optional Tavily / Brave API key | `settings` table, local database | Settings UI |

## Secrets

**No secret ever enters the repository, an environment variable, or a log file.**

The only credential this product can hold is an optional user-supplied search API key. It is:

- entered in the settings UI, never in a file the user has to edit;
- stored in the local database, on the user's machine only;
- never logged, never included in an export, never sent anywhere except the provider it belongs to;
- never required — the default search path works without any key, because an open-source repository cannot ship one.

A key in a `.env`, a config file, or a commit is a defect, not a convenience ([security.md](security.md)).

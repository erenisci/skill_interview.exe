---
title: Logging
discipline: ops
status: active
updated: 2026-09-02
---

# Logging

> **Purpose.** What is logged, in what form, and — importantly for a privacy-first local app — what is never logged.
> **Related.** [error-handling.md](error-handling.md) · [security.md](security.md)

## Levels

| Level   | Use                                                                               | In release builds |
| ------- | --------------------------------------------------------------------------------- | ----------------- |
| `error` | A job failed terminally; a fatal startup problem                                  | Yes               |
| `warn`  | A retry, a provider degradation, a validation rejection                           | Yes               |
| `info`  | Lifecycle: app start, migration applied, job started and finished, model released | Yes               |
| `debug` | Stage timings, token counts, queue transitions                                    | Development only  |

Default in release is `info`. There is no user-facing log-level setting in v1; if support ever needs one, it is a
setting, not an environment variable.

## Format

- Structured, one JSON object per line — greppable, and parseable when someone pastes it into an issue.
- Written to a rotating file in the app data directory, next to the database. Rotated by size, a small number of
  files kept, so logs never grow without bound on a user's machine.
- In development, also written to the console.
- Every line carries: timestamp, level, area (`queue`, `pipeline`, `llm`, `search`, `db`, `ipc`, `scheduler`), and
  a message. Pipeline lines also carry `job_id`, `stage`, and `attempt`.

**Logs never leave the machine.** There is no crash reporter, no remote sink, no telemetry — that is a product
guarantee, not a default that could be flipped ([../product/requirements-nfr.md](../product/requirements-nfr.md)).

## What to Log

- App lifecycle: start, version, migration from version → version, clean shutdown.
- Ollama detection results: reachable or not, model list length, selected model id.
- Job transitions: enqueued, started, stage completed, retried with reason, failed with reason, completed.
- Validation rejections **with the rule that fired** — this is the signal that tells prompt problems from model problems.
- Provider degradation: which provider failed and which one carried the request.
- Model lifecycle: loaded, released when the queue drained. Directly tied to the memory design.
- Timings for retrieval and generation, so slowness can be attributed.

## What Not to Log

This list matters more than the one above. The app holds something genuinely sensitive: **the user's skill list is
effectively their CV and their knowledge gaps**.

| Never log                                            | Why                                         |
| ---------------------------------------------------- | ------------------------------------------- |
| Skill names                                          | The user's CV and what they do not know     |
| Card or question text                                | The generated content itself                |
| The user's answers or which questions they got wrong | The most sensitive data the app holds       |
| API keys, in any form, including partially masked    | A masked key is still a leaked key fragment |
| Full URLs with query strings from search calls       | Query strings contain skill names           |
| File paths containing a Windows username             | Ends up in pasted logs                      |
| Retrieved source text                                | Volume, and it is untrusted content         |

Log **shapes and identifiers**, not content: `skill_id`, not the name; "card rejected: length band", not the card.

A log line that would embarrass the user if they pasted it into a public issue is a bug. This is checked as part of
[../quality/qa-checklist.md](../quality/qa-checklist.md) before every release.

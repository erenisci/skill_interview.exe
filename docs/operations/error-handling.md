---
title: Error Handling
discipline: ops
status: active
updated: 2026-09-02
---

# Error Handling

> **Purpose.** How failures are represented, propagated, and shown — so nothing fails silently.
> **Related.** [logging.md](logging.md) · [../llm/guardrails.md](../llm/guardrails.md) · [../engineering/coding-standards.md](../engineering/coding-standards.md)

## Principles

1. **Silent failure is the worst outcome.** An empty card with no explanation is worse than a visible failed job.
   The user must always be able to tell the difference between "nothing here yet" and "this went wrong".
2. **Failure is a normal state in the pipeline, not an exception.** Search providers break, models return garbage,
   networks drop. These are expected outcomes with expected handling, not crashes.
3. **Never degrade into invention.** When retrieval fails, the job fails. There is no path where a lower-quality
   ungrounded result is produced instead ([../llm/guardrails.md](../llm/guardrails.md)).
4. **Fail the smallest unit.** One skill's research failing must not stop the queue or affect other skills.
5. **Errors carry context to where they are handled**, and are logged once — at the boundary, not at every level.

## Error Types

| Type              | Examples                                                             | Handling                                                                     |
| ----------------- | -------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| **Transient**     | Network timeout, provider 429, Ollama busy                           | Retry with backoff, up to the attempt limit                                  |
| **Provider**      | Search returns nothing usable, or nothing that resolves to the skill | Degrade to remaining providers; fail on zero **resolved** sources            |
| **Validation**    | Malformed JSON, schema mismatch, question with two correct answers   | Retry generation; after the limit, fail the job. Nothing invalid is stored   |
| **Configuration** | Ollama unreachable, model missing, invalid API key                   | Not retried. Surfaced in the setup screen or settings with the specific fix  |
| **Data**          | Migration failure, corrupt database                                  | Fatal. The app reports rather than starting on a half-migrated database      |
| **Programmer**    | Broken invariant, impossible state                                   | Fail loudly in development; log and fail the job in release. Never swallowed |

## Propagation

**Within the pipeline:** stages return result-shaped values rather than throwing across stage boundaries. A stage
failure marks the job, leaves the database consistent, and lets the queue decide about retrying.

**Across the queue:** a job records `attempts` and its last `error` string. After the attempt limit it becomes
`failed` and stops consuming the queue. Jobs stuck in `running` after an abrupt shutdown are reset at startup
([../architecture/database-design.md](../architecture/database-design.md)).

**Across IPC:** errors cross as typed result objects, never as thrown exceptions. The renderer receives a discriminated
union it must handle, so an unhandled failure is a type error rather than a blank screen.

**Fatal errors:** only migration and database-open failures. They stop startup with a message that says what happened
and where the database is — never a stack trace in a dialog box.

## User-Facing vs Internal

| Audience | Content                                                                                                                                                   |
| -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **User** | What failed, whether it can be retried, and what they can do. Plain language, in the UI language, with a retry action where one exists                    |
| **Log**  | Error type, job id, stage, provider, attempt count, and the technical detail. **Never** skill names, card content, or API keys ([logging.md](logging.md)) |

Messages that must be distinguishable, because the fix differs:

| Situation            | Must not be conflated with           |
| -------------------- | ------------------------------------ |
| Ollama not installed | Ollama installed but no model pulled |
| Model missing        | Model removed after being selected   |
| No network           | Search provider returned nothing     |
| Job failed           | Job still running                    |
| No content yet       | Nothing due today                    |

Getting these distinctions right is most of the perceived quality of the app's error handling.

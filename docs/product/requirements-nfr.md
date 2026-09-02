---
title: Non-Functional Requirements
discipline: product
status: active
updated: 2026-09-02
---

# Non-Functional Requirements

> **Purpose.** The quality bars the system must meet, independent of any feature.
> **Related.** [requirements-functional.md](requirements-functional.md) · [../operations/performance.md](../operations/performance.md) · [../operations/security.md](../operations/security.md)

## Performance

| ID     | Requirement                                                        | Target                                                               |
| ------ | ------------------------------------------------------------------ | -------------------------------------------------------------------- |
| NFR-01 | The model must not be resident during daily use.                   | Model unloaded once the job queue drains                             |
| NFR-02 | Idle memory footprint during reading and quizzing.                 | Electron baseline plus app data; a UI that inflates this is a defect |
| NFR-03 | Cold start to the daily set.                                       | Under 3 seconds on a mid-range machine                               |
| NFR-04 | Daily-set queries hit only SQLite, never the model or the network. | No LLM or HTTP call in the read path                                 |
| NFR-05 | Research and generation for one skill.                             | Minutes, asynchronous, never blocking the UI                         |

Concrete budgets and how they are measured: [../operations/performance.md](../operations/performance.md).

## Reliability

| ID     | Requirement                                                                                            |
| ------ | ------------------------------------------------------------------------------------------------------ |
| NFR-10 | Killing the app mid-job must not corrupt the database; jobs resume or reset on next start.             |
| NFR-11 | A failed search provider degrades to the remaining providers rather than failing the job.              |
| NFR-12 | A model producing invalid output fails validation and retries; it never persists a malformed question. |
| NFR-13 | The database is the only durable state; deleting it is a full reset, not a crash.                      |

## Security

| ID     | Requirement                                                                                         |
| ------ | --------------------------------------------------------------------------------------------------- |
| NFR-20 | No user data leaves the machine. The only outbound traffic is web research.                         |
| NFR-21 | No telemetry, analytics, or crash reporting to any remote endpoint.                                 |
| NFR-22 | User-supplied API keys are stored locally and never logged or committed.                            |
| NFR-23 | The renderer runs with `contextIsolation` on and `nodeIntegration` off; all privileged work is IPC. |
| NFR-24 | Retrieved web content is untrusted input and is never treated as instructions to the model.         |

Detail: [../operations/security.md](../operations/security.md) and [../llm/guardrails.md](../llm/guardrails.md).

## Usability

| ID     | Requirement                                                                                 |
| ------ | ------------------------------------------------------------------------------------------- |
| NFR-30 | Adding a skill takes one text field and one action.                                         |
| NFR-31 | The daily set is reachable in one click from launch.                                        |
| NFR-32 | Generation progress is visible without the user seeking it out.                             |
| NFR-33 | Every generated claim is traceable to a source the user can open.                           |
| NFR-34 | The UI must be pleasant enough to sustain a daily habit; this is a requirement, not polish. |

## Maintainability

| ID     | Requirement                                                                          |
| ------ | ------------------------------------------------------------------------------------ |
| NFR-40 | LLM and search providers sit behind adapters; swapping one touches no pipeline code. |
| NFR-41 | Every generated artefact records its model and prompt version.                       |
| NFR-42 | Prompt changes are gated by the eval suite.                                          |
| NFR-43 | Schema changes ship as ordered, forward-only migrations.                             |

## Constraints

| ID     | Constraint                                                                                        |
| ------ | ------------------------------------------------------------------------------------------------- |
| NFR-50 | Windows only.                                                                                     |
| NFR-51 | Ollama is a required external dependency for v1.                                                  |
| NFR-52 | No API key may be embedded in the repository; the default search path must work without one.      |
| NFR-53 | Application code is MIT; generated content inherits source licenses and their attribution duties. |
| NFR-54 | Solo maintainer — no process that assumes a second person.                                        |

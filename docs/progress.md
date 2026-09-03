---
title: Progress
discipline: project
status: active
updated: 2026-09-03
---

# Progress

> **Purpose.** Where the project actually stands right now. Kept current by `/acta:track`.
> **Related.** [project/roadmap.md](project/roadmap.md) · [../CHANGELOG.md](../CHANGELOG.md)

## Current Status

**M-1 done and verified against a real model.** The app launches, creates and migrates its database, serves the
skills view over a sandboxed IPC boundary, lists installed Ollama models, and completes a round-trip generation whose
schema-constrained output parses. Releasing the model with `keep_alive: 0` was verified as well, so the memory design
is proven rather than asserted.

The first honest end-to-end measurement took **82.8 s** for a two-sentence card. It now takes **0.9 s warm, at 100%
GPU** — two settings found by measuring, both now in the adapter and documented in
[operations/performance.md](operations/performance.md).

**M-2 has started.** The durable job queue is in and covered: it retries transient failures with a backoff that
survives a restart, refuses to retry a configuration failure, gives up after a limit, resumes work interrupted by a
crash, and releases the model exactly once per drain. Migration 002 was applied to a copy of the real database before
being committed. 56 tests, clean typecheck, lint and build.

## In Progress

- Nothing actively in flight. M-2 is next.

## Done (recent)

| Date       | What                                                                                                          |
| ---------- | ------------------------------------------------------------------------------------------------------------- |
| 2026-09-02 | Documentation set and Acta brain generated (`/acta:build`)                                                    |
| 2026-09-02 | M-1: Electron + TypeScript + React scaffold; sandboxed renderer; typed IPC returning `Result`                 |
| 2026-09-02 | M-1: SQLite schema, forward-only migrations, repositories for skills / settings / jobs                        |
| 2026-09-02 | M-1: `LlmAdapter` with Ollama and stub implementations                                                        |
| 2026-09-02 | [ADR-0002](architecture/adr/0002-constrained-decoding.md) — JSON Schema at the runtime, plus a parse          |
| 2026-09-02 | Search coverage + precision probes (`evals/probes/`) — naive search grounds to the wrong subject              |
| 2026-09-02 | [ADR-0003](architecture/adr/0003-source-resolution.md) — resolution gates; GitHub primary, DuckDuckGo dropped |
| 2026-09-02 | Repository made ready for public release; brief archive and Acta registry excluded                            |
| 2026-09-03 | `think: false` and `num_gpu: 99` added to the adapter after measurement — 82.8 s → 0.9 s, 100% GPU            |
| 2026-09-03 | **M-1 signed off** — all four exit criteria verified against a real `qwen3:4b`                                |
| 2026-09-03 | M-2: durable job queue with retry, backoff surviving restarts, and model release on drain (21 tests)          |

## Blocked

- Nothing.

## Next Up

1. M-2 — `SearchAdapter` (GitHub `in:name`, official docs, Wikipedia)
2. M-2 — the resolution stage: deterministic name gate, then the `resolve-source` model call ([ADR-0003](architecture/adr/0003-source-resolution.md))
3. M-2 — HTML→text extraction and the truncation budget, tuned together with `num_ctx`
4. M-2 — the primer-card prompt and the synthesis stage, with sources stored and shown
5. Wire `SKILL_INTERVIEW_DATA_DIR` so a development database can live outside `%APPDATA%` ([operations/env-vars.md](operations/env-vars.md))
6. Add the CI workflow described in [operations/ci-cd.md](operations/ci-cd.md); no pipeline exists yet

## Open Decisions

- **`qwen3:4b` is the recommended model, as a hypothesis.** One model is installed, and development and production
  deliberately share it. Nothing has yet shown it clears the quality bar; the eval harness exists to falsify it, and
  the falsifying conditions are in [llm/architecture.md](llm/architecture.md) ([TD-07](project/tech-debt.md)).
  First small signal: one generated sentence contained a stray duplicated token. Not blocking, but exactly what the
  eval sets are for.
- **Cross-family prompt variance is unmeasurable with one model** ([TD-09](project/tech-debt.md)), so
  [TD-04](project/tech-debt.md) stays open longer than planned. Accepted for v1.
- Whether constrained decoding costs prose quality. Unmeasured, and in scope for the eval harness.
- Whether `num_gpu: 99` is safe on GPUs smaller than the reference machine's 4 GB. Configurable, but untested there.

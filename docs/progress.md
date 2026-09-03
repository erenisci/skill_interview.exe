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

**M-2 is done and verified end to end.** Adding a skill now enqueues background research that searches, resolves,
fetches, synthesizes and stores a card with its sources — with the model released when the queue drains. Against the
real APIs and a real model: `nginx` produced an accurate three-paragraph primer in 10.8 s, and `Zustand` resolved to
`pmndrs/zustand` rather than the Wikipedia article on Pompeii. 117 tests.

Its parts:

- The **durable job queue** — retries transient failures with a backoff that survives a restart, refuses to retry a
  configuration failure, gives up after a limit, resumes work interrupted by a crash, and releases the model exactly
  once per drain. Migration 002 was applied to a copy of the real database before being committed.
- The **search adapters** — GitHub (repository plus its declared documentation), Wikipedia, and HTML/Markdown
  extraction. They return **candidates**, never sources: the text of a candidate is not even fetched until resolution
  has accepted it.
- The **resolution stage** — the deterministic name gate plus the `resolve-source` model call. Against the real
  model it scored 5/5 on the collisions the precision probe found, **including all three whose right answer is
  "none"**. That was the riskiest assumption in ADR-0003.

## In Progress

- Nothing in flight. M-3 (the skill graph) is next.

## Done (recent)

| Date       | What                                                                                                          |
| ---------- | ------------------------------------------------------------------------------------------------------------- |
| 2026-09-02 | [ADR-0002](architecture/adr/0002-constrained-decoding.md) — JSON Schema at the runtime, plus a parse          |
| 2026-09-02 | Search coverage + precision probes (`evals/probes/`) — naive search grounds to the wrong subject              |
| 2026-09-02 | [ADR-0003](architecture/adr/0003-source-resolution.md) — resolution gates; GitHub primary, DuckDuckGo dropped |
| 2026-09-02 | Repository made ready for public release; brief archive and Acta registry excluded                            |
| 2026-09-03 | `think: false` and `num_gpu: 99` added to the adapter after measurement — 82.8 s → 0.9 s, 100% GPU            |
| 2026-09-03 | **M-1 signed off** — all four exit criteria verified against a real `qwen3:4b`                                |
| 2026-09-03 | M-2: durable job queue with retry, backoff surviving restarts, and model release on drain                     |
| 2026-09-03 | M-2: search adapters returning candidates, plus HTML/Markdown extraction                                      |
| 2026-09-03 | Measured GitHub query strategies — `in:name` from ADR-0003 was wrong; plain relevance scores 7/7 against 6/7  |
| 2026-09-03 | M-2: resolution stage — name gate calibrated against real names, subject check 5/5 on a real model            |
| 2026-09-03 | M-2: primer synthesis, the research pipeline, and a UI that shows a card with its sources                     |
| 2026-09-03 | **M-2 signed off** — `nginx` and `Zustand` produce correct, grounded cards against real APIs and a real model |

## Blocked

- Nothing.

## Next Up

1. M-3 — classification into category and tags during research, then relation computation
2. Settle the truncation budget and `num_ctx` against real retrieved text; both are still provisional
3. Wire `SKILL_INTERVIEW_DATA_DIR` so a development database can live outside `%APPDATA%` ([operations/env-vars.md](operations/env-vars.md))
4. Add the CI workflow described in [operations/ci-cd.md](operations/ci-cd.md); no pipeline exists yet

## Open Decisions

- **`qwen3:4b` is the recommended model, as a hypothesis.** One model is installed, and development and production
  deliberately share it. Nothing has yet shown it clears the quality bar; the eval harness exists to falsify it, and
  the falsifying conditions are in [llm/architecture.md](llm/architecture.md) ([TD-07](project/tech-debt.md)).
  Signals so far point both ways: one generated sentence contained a stray duplicated token, and one resolution
  explanation contradicted itself — but the `nginx` and `Zustand` primers were accurate, readable, and faithful to
  their sources. Encouraging, and still not a measurement.
- **Cross-family prompt variance is unmeasurable with one model** ([TD-09](project/tech-debt.md)), so
  [TD-04](project/tech-debt.md) stays open longer than planned. Accepted for v1.
- Whether constrained decoding costs prose quality. Unmeasured, and in scope for the eval harness.
- Whether `num_gpu: 99` is safe on GPUs smaller than the reference machine's 4 GB. Configurable, but untested there.

---
title: Progress
discipline: project
status: active
updated: 2026-09-02
---

# Progress

> **Purpose.** Where the project actually stands right now. Kept current by `/acta:track`.
> **Related.** [project/roadmap.md](project/roadmap.md) · [../CHANGELOG.md](../CHANGELOG.md)

## Current Status

**M-1 built, partly unverified.** The application exists and runs: it launches, creates its database, applies
migrations, and serves the skills view over a sandboxed IPC boundary. Storage, the adapter layer, and the startup
readiness check are in place, with 32 tests, a clean typecheck, a clean lint, and a working build.

Two of M-1's exit criteria — listing installed models and completing one round-trip prompt — are implemented and
covered by tests against a stubbed `fetch`, but have **never run against a real Ollama**. No model is installed on
the development machine yet. M-1 is not ticked until they do.

## In Progress

- Nothing actively in flight.

## Done (recent)

| Date       | What                                                                                                          |
| ---------- | ------------------------------------------------------------------------------------------------------------- |
| 2026-09-02 | Project brief completed; scope narrowed to technical skills, Electron over Rust/Tauri, MIT, Windows-only      |
| 2026-09-02 | Documentation set and Acta brain generated (`/acta:build`)                                                    |
| 2026-09-02 | M-1: Electron + TypeScript + React scaffold; sandboxed renderer; typed IPC returning `Result`                 |
| 2026-09-02 | M-1: SQLite schema, forward-only migrations, repositories for skills / settings / jobs                        |
| 2026-09-02 | M-1: `LlmAdapter` with Ollama and stub implementations; `keep_alive` release and constrained decoding         |
| 2026-09-02 | M-1: startup readiness check distinguishing missing runtime, missing model, and removed model                 |
| 2026-09-02 | [ADR-0002](architecture/adr/0002-constrained-decoding.md) — JSON Schema at the runtime, plus a parse          |
| 2026-09-02 | Search coverage + precision probes (`evals/probes/`) — naive search grounds to the wrong subject              |
| 2026-09-02 | [ADR-0003](architecture/adr/0003-source-resolution.md) — resolution gates; GitHub primary, DuckDuckGo dropped |

## Blocked

- **M-1 sign-off needs a local model.** `listModels()` and one real generation round-trip cannot be verified until
  Ollama is installed and a model pulled. Everything else in M-1 is done. Plan: `qwen3:4b` for development (fits the
  4 GB VRAM on this machine), `gemma3:4b` as a second family, `qwen3:8b` for quality evals.

## Next Up

1. Verify M-1's two remaining exit criteria against a real Ollama, then tick M-1 in [project/roadmap.md](project/roadmap.md)
2. M-2 — `SearchAdapter` (GitHub `in:name`, official docs, Wikipedia) and the resolution stage ([ADR-0003](architecture/adr/0003-source-resolution.md))
3. M-2 — the durable job queue loop: claim, retry, terminal failure, and releasing the model when it drains
4. M-2 — the primer-card prompt and the synthesis stage, with sources stored and shown
5. Wire `SKILL_INTERVIEW_DATA_DIR` so a development database can live outside `%APPDATA%` ([operations/env-vars.md](operations/env-vars.md))
6. Add the CI workflow described in [operations/ci-cd.md](operations/ci-cd.md); no pipeline exists yet

## Open Decisions

- **Recommended model size is now an open question, not a settled assumption.** The docs assume an 8B-class model,
  but an 8B Q4 (~5 GB) does not fit the 4 GB VRAM on the development machine — a very common laptop configuration.
  M-7 must therefore answer "what is the smallest model that clears the quality bar", not only "which model family".
  See [llm/architecture.md](llm/architecture.md) and [TD-04](project/tech-debt.md).
- Supported-model allowlist versus per-model prompt variants — narrowed by [ADR-0002](architecture/adr/0002-constrained-decoding.md),
  which makes schema conformance a runtime guarantee; what remains model-dependent is content quality.
- Whether constrained decoding costs prose quality. Unmeasured, and now in scope for the eval harness.

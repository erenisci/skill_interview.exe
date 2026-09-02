---
title: 'ADR 0001: Initial architecture — Electron + TypeScript, local-first, generation split from consumption'
discipline: code
status: Accepted
date: 2026-09-02
---

# ADR 0001: Initial architecture

## Status

Accepted — 2026-09-02

## Context

The product must satisfy three requirements that pull against each other:

1. **A local LLM.** Content quality depends on a model large enough to write correct technical prose and plausible
   distractors — 8B class, roughly 5 GB resident when quantized to Q4.
2. **Low memory and CPU.** Stated explicitly by the author as a product requirement, not a preference.
3. **A desktop app pleasant enough to open daily**, built by one person, in Java, Python, JavaScript, or TypeScript
   — the languages already on hand. Learning a new language before writing product code was ruled out.

Taken naively these are contradictory: a 5 GB model is not a low-memory application.

**Shell options considered.**

| Option                | Baseline | Verdict                                                                                 |
| --------------------- | -------- | --------------------------------------------------------------------------------------- |
| Rust + Tauri          | ~60 MB   | Lowest footprint, but Rust is a new language for the author. Rejected on learning cost. |
| Electron + TypeScript | ~200 MB  | Known language, best UI ecosystem, mature packaging.                                    |
| Python + PySide6      | ~100 MB  | Known language, lighter, but weaker UI ecosystem and painful packaging.                 |
| Java + JavaFX         | ~150 MB  | Known language, weakest UI ecosystem for this product.                                  |

**LLM runtime options.** Bundling llama.cpp gives a self-contained installer but requires shipping GPU backends and
per-platform binaries plus an in-app multi-gigabyte download — weeks of build work before any product exists.
Ollama is an external install with a trivial HTTP API.

**Search options.** No free, key-less general web search API exists. An open-source repository cannot ship an API key.

## Decision

**1. Split generation from consumption.** The LLM runs only in a background job queue, for minutes at a time, and is
released when the queue drains. Daily use — cards, questions, scheduling — reads SQLite exclusively: no model, no
network in the read path. This is the decision that makes requirements 1 and 2 compatible, and everything else
follows from it.

**2. Electron + TypeScript + React.** One language across UI and pipeline, the strongest UI ecosystem, solved
packaging. The ~200 MB baseline is accepted: during generation it is 4% of the model's footprint, and during daily
use the model is gone, so the app is ~200 MB total.

**3. SQLite via `better-sqlite3` with FTS5** as the single durable store. Jobs are rows, not in-memory promises, so
a killed process is recoverable.

**4. Ollama as a required external dependency for v1**, behind a `LlmAdapter` interface. Embedded inference and
cloud models become alternate implementations rather than a rewrite.

**5. Key-less search by default** — Wikipedia API and DuckDuckGo — behind a `SearchAdapter`, with user-supplied
Tavily or Brave keys as an optional upgrade. No key ever enters the repository.

**6. Windows only.** Mobile is out of scope permanently; macOS and Linux are Later.

## Consequences

**Easier.**

- The memory requirement is met structurally rather than by optimization.
- One language, one runtime, one build. A solo author can hold the whole system.
- Crash recovery is nearly free: job state is already durable.
- Providers are swappable. Replacing Ollama, or adding a cloud model, touches one file.
- Development starts immediately — no new language to learn first.

**Harder.**

- **Ollama is a hard dependency.** The largest onboarding drop-off in v1, and it puts model quality outside our
  control ([TD-01](../../project/tech-debt.md)).
- **~200 MB baseline with no headroom.** The performance goal holds only because the model is unloaded; a heavy UI
  would break it. Guarded by a budget in [../../operations/performance.md](../../operations/performance.md) ([TD-05](../../project/tech-debt.md)).
- **Generation is not interactive.** The user cannot ask a follow-up question. This is a real product limitation
  accepted in exchange for the memory profile.
- **Electron's security model must be respected deliberately** — `contextIsolation` on, `nodeIntegration` off, and
  all privileged work behind typed IPC. The renderer displays untrusted web-derived content.
- **Prompts are tuned against one model but users choose their own**, so output quality varies by installed model
  ([TD-04](../../project/tech-debt.md)). Unresolved; M-7's eval run decides between an allowlist and per-model variants.
- **DuckDuckGo scraping has no contract** and will break without warning ([TD-02](../../project/tech-debt.md)).

**At scale.** The design targets one user's library. Multiple users, sync, or a shared corpus would be a redesign,
not a configuration change. Within a single library it scales to thousands of cards without difficulty.

<!-- ADRs are per-item and immutable except Status. To change a decision, add a new ADR that supersedes this one. -->

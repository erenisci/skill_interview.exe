---
title: AI Decision Log
discipline: ai
status: active
updated: 2026-09-03
---

# AI Decision Log

> **Purpose.** Decisions taken during AI-assisted work, with their reasoning — so the _why_ outlives the conversation.
> **Related.** [../architecture/adr/README.md](../architecture/adr/README.md) · [ai-guidelines.md](ai-guidelines.md)

Append-log. Newest entries on top. Never rewrite history.

Architectural decisions get a full ADR. This log holds the smaller ones — and, importantly, the decisions made
_during_ an AI-assisted session whose reasoning would otherwise be lost when the chat window closes.

Each entry: date · decision · rationale · who decided.

---

## 2026-09-03 — Thinking off, all layers forced onto the GPU

**Decision.** Every generation request sends `think: false` and `options.num_gpu: 99`, alongside the explicit
`num_ctx` the docs already required.
**Rationale.** Both came from measuring the first real end-to-end run, which took **82.8 s** for a two-sentence card.
`think: false` removed ~18 s per request of reasoning trace that never reaches the user (one uncontrolled run reached
134 s); the model tasks here are not reasoning problems. `num_gpu: 99` fixed a 33% CPU offload that Ollama's own
estimate had chosen while leaving 1.6 GB of a 4 GB card unused — lowering the context did not fix it and cost
capability for nothing. Together: 82.8 s → **0.9 s warm, 100% GPU, full 4096 context**.
**Cost, accepted.** Forcing the offload could fail to allocate on a GPU smaller than the reference machine's, so it
is configurable and a failure surfaces as a configuration error rather than a silent slowdown.
**Worth remembering.** The bottleneck that had been documented at length (GPU residency) was real but secondary. The
dominant one was not on the list at all, and only appeared because the run was timed instead of assumed.
**Decided by.** Author, after measurement — prompted by his insistence that partial CPU offload not be accepted.

## 2026-09-02 — One model, and it is the production one

**Decision.** Install only `qwen3:4b` (~2.5 GB). It is both the development model and the recommended one,
superseding the earlier split of "4B for development, 8B for quality". The model must also run **fully on the GPU**,
which makes the context budget a performance constraint rather than only a prompt one.
**Rationale.** VRAM, and only VRAM. The development machine was measured rather than assumed: RTX 3050 Ti Laptop
with 4096 MiB, 15.8 GB system RAM, 585 GB free disk. **Disk is not a constraint and was wrongly cited as one** in an
earlier draft of this entry. An 8B Q4 is ~4.7–4.9 GB of weights before any KV cache, so it cannot fit 4096 MiB and
spills onto the CPU — on this machine and on the large share of users with the same class of GPU. Building against a
model neither party can run well is how quality decisions get made on imaginary hardware. Two reasons for a larger
model are already gone: schema conformance moved to the runtime
([ADR-0002](../architecture/adr/0002-constrained-decoding.md)) and distractor assembly moved into code.
**Cost, accepted.** Cross-family variance becomes unmeasurable ([TD-09](../project/tech-debt.md)), so
[TD-04](../project/tech-debt.md) stays open; and 4B clearing the quality bar is a hypothesis, not a result
([TD-07](../project/tech-debt.md)).
**Decided by.** Author.

## 2026-09-02 — M-1 implementation decisions

**Decision.** Four smaller choices made while building the skeleton: (a) the stub `LlmAdapter` is the default when
no model is configured, so the app boots and everything except generation works; (b) SQLite's `user_version` is the
authoritative schema version, with `settings.db_schema_version` mirroring it; (c) development uses a 4B model while
quality is judged on 8B; (d) the toolchain pins `vite@7` / `@vitejs/plugin-react@5` / `vitest@3` together.
**Rationale.** (a) follows from generation being split from consumption — there is no reason a missing model should
block storage, IPC, or the UI, and it keeps the whole app buildable before any model exists. (b) `settings` is
created by migration 1, so on a first run there is no table to read the version from; the bootstrap has to live in a
header field that predates every table. (c) a 4B model fits the 4 GB laptop GPU entirely and iterates fast, while
quality decisions belong on the model users will actually run. (d) `electron-vite@5` caps at `vite@7` and the current
`@vitejs/plugin-react` wants `vite@8` — the conflict is upstream, not a preference.
**Decided by.** Author, during the M-1 build. The one decision large enough for an ADR — constrained decoding —
is recorded separately as [ADR-0002](../architecture/adr/0002-constrained-decoding.md).

## 2026-09-02 — Scope narrowed to technical skills only

**Decision.** The product covers technical skills. Exam subjects and general knowledge move to Later.
**Rationale.** The name and the interview use case both point at technical content, and a narrower scope sharpens
prompts and distractor generation. The engine stays general, so opening the scope later is cheap.
**Decided by.** Author, during the brief.

## 2026-09-02 — Electron + TypeScript over Rust/Tauri

**Decision.** Electron, accepting the ~200 MB baseline.
**Rationale.** Tauri's ~60 MB baseline is better, but Rust is a new language for the author; the languages on hand are
Java, Python, JS, and TS. The memory requirement is met structurally by unloading the model between jobs, which makes
the shell's footprint a small share of the real cost. Full reasoning in
[../architecture/adr/0001-initial-architecture.md](../architecture/adr/0001-initial-architecture.md).
**Decided by.** Author, after an AI-assisted comparison of Tauri, Electron, PySide6, and JavaFX.

## 2026-09-02 — MIT license

**Decision.** MIT for the application code.
**Rationale.** Maximum adoption and the simplest terms for a portfolio-facing project. GPL-3.0 was considered for its
protection against someone closing and selling a fork; the author judged that outcome acceptable. Content licensing is
a separate matter — Wikipedia-derived text is CC BY-SA and carries attribution duties
([../llm/rag-sources.md](../llm/rag-sources.md)).
**Decided by.** Author, after an AI-assisted comparison of MIT, Apache-2.0, and GPL-3.0.

## 2026-09-02 — Mobile dropped entirely

**Decision.** No mobile application, in v1 or later.
**Rationale.** A phone cannot run a model large enough for this content quality, and a reader-only mobile client
requires a sync mechanism that conflicts with the local-only guarantee. Desktop is the product.
**Decided by.** Author.

## 2026-09-02 — Distractors assembled from sibling skills

**Decision.** Wrong options are built by code from related skills' real properties; the model is asked to use them
rather than invent them. Model-generated distractors are a marked fallback used only when fewer than three sibling
facts are available.
**Rationale.** Small models produce distractors that are either obviously wrong or accidentally true. The user's own
skill graph is a free source of plausible-and-wrong material, and it is the one thing this product has that generic
tools do not. `options.source_skill_id` records the origin so the eval harness can prove whether the design works.
**Decided by.** Author, during architecture discussion.

## 2026-09-02 — Model-dependent prompts left unresolved

**Decision.** Do not choose between a supported-model allowlist and per-model prompt variants yet. Write prompts as
plainly as possible in the meantime, avoiding model-specific formatting tricks.
**Rationale.** The right answer depends on how much output actually varies across models, which is measurable in M-7
and guesswork before it. The plain-prompt approach degrades gracefully whichever way the decision goes. Recorded as
[TD-04](../project/tech-debt.md).
**Decided by.** Author, prompted by the observation that prompts depend on whichever model the user installed.

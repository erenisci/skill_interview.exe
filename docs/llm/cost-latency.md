---
title: Cost & Latency
discipline: llm
status: active
updated: 2026-09-02
---

# Cost & Latency

> **Purpose.** What generation costs in time and memory, and where the budgets sit.
> **Related.** [architecture.md](architecture.md) · [../operations/performance.md](../operations/performance.md)

The model runs locally, so there is **no monetary cost per token**. The currencies here are **memory, time, and
battery** — and the design spends them all in one place, on purpose.

## Token Budget

| Task              | Input                                             | Output                            |
| ----------------- | ------------------------------------------------- | --------------------------------- |
| Synthesize primer | Retrieved text, truncated to 8,000 chars          | 400–6,000 chars                   |
| Classify          | Card excerpt, truncated to 2,000 chars            | Small structured object           |
| Comparison card   | Two skills' sources, 4,000 chars a side           | 400–6,000 chars                   |
| Separate a pair   | Two skills' primers, 3,000 chars a side           | A handful of one-sentence claims  |
| Word a question   | The assembled correct option and three wrong ones | Stem plus explanation             |
| Resolve a source  | Skill name plus up to five candidates' leads      | An index or `null`, plus a reason |

Retrieved text is truncated rather than summarized by an extra model call: a summarization pass would double the
generation time and add a place for facts to be lost before the writer ever sees them.

**The token budget is bounded by VRAM as well as by prompt length**, but less tightly than first assumed. The KV
cache grows with `num_ctx`, and on a 4 GB card holding a ~2.5 GB model the slack is small. Measurement showed that
forcing all layers onto the GPU (`num_gpu`) keeps a 4096 context fully resident at 3.2 GB, so the context does not
have to be sacrificed for residency — which was the intuitive move and the wrong one. Flash attention and a
quantized KV cache extend that headroom further, at the user's option
([../operations/performance.md](../operations/performance.md)).

Measured per request on the reference machine: **~0.9 s warm, ~5.1 s cold** (4.0 s of that being the model load,
which `keep_alive` amortizes across a job run).

**Settled, 2026-09-03** (`evals/probes/context-probe.mjs`), against real Wikipedia articles rather than guessed
text — PostgreSQL and Kubernetes run 32,000–39,000 characters, so the primer's 8,000-character budget always
truncates a substantial source. Every prompt measured comfortably under `num_ctx: 4096`; the tightest is the primer
at ~1,958 input tokens, which stays clear of the window even at its declared 6,000-character output ceiling
(≈1,463 tokens, ~675 spare). `num_ctx: 8192` was also measured and fits the reference 4 GB card at 100% GPU
(3.8 GB) — kept as a documented option rather than the default, since it spends 95% of that card's VRAM on headroom
nothing currently needs.

Raising a truncation budget without raising `num_ctx` to match is not free: the source truncation and the context
window were sized together, and growing one without the other risks the source alone overflowing the prompt before
the model writes a word. Whether more source text is worth that trade — the current budget discards most of the
Kubernetes and PostgreSQL articles — is a quality question for the eval harness (M-7), not a safety one; this
section settles only that the current numbers do not overflow.

## Caching

| What                          | Cached?                           | Why                                                                                                     |
| ----------------------------- | --------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Generated cards and questions | **Yes — permanently**             | The whole architecture. Generated once, read thousands of times from SQLite                             |
| Retrieved sources             | Yes, stored with the card         | Regeneration and provenance both need them                                                              |
| Model responses               | No                                | Every task has different input; a response cache would never hit                                        |
| Model weights in memory       | Only while the queue is non-empty | Releasing the model is the memory design ([ADR-0001](../architecture/adr/0001-initial-architecture.md)) |

The product is essentially one large cache: the expensive path runs once per skill, and the daily path is a database
read. That is why "local LLM" and "must not eat RAM" are compatible at all.

## Latency Targets

Two paths with completely different requirements:

| Path                                       | Target                              | Rationale                                 |
| ------------------------------------------ | ----------------------------------- | ----------------------------------------- |
| **Read path** — daily set, cards, answers  | Instant; cold start under 3 seconds | SQLite only; no model, no network         |
| **Generation path** — research a new skill | Minutes, asynchronous               | The user never waits; progress is visible |

Generation is explicitly _allowed_ to be slow. The one hard rule is that it must never block the UI, and its progress
must be visible without the user going looking for it.

**Serial by design.** One LLM job at a time. Parallelism would double the resident memory — the exact thing the
architecture exists to avoid — and buys nothing for a single user.

Measured on the reference machine — see the per-request numbers above. They still depend on the user's hardware,
model size and quantization; the reference machine is the deliberately-chosen floor, not a promise for every machine
([operations/performance.md](../operations/performance.md)).

## Fallbacks

| Failure                               | Response                                                                              |
| ------------------------------------- | ------------------------------------------------------------------------------------- |
| Ollama unreachable                    | Jobs stay queued; setup screen explains; nothing is lost                              |
| Model unloaded by Ollama between jobs | Adapter reloads on next use — expected, not an error                                  |
| Generation exceeds a sane time limit  | Job times out, retries, then fails visibly                                            |
| Malformed output                      | Retry up to the attempt limit, then fail; nothing malformed is stored                 |
| One search provider down              | Degrade to the remaining providers; only zero usable sources fails the job            |
| Machine too slow for the chosen model | The user picks a smaller model; quality trade-off is theirs, and stamped on every row |

There is no fallback to ungrounded generation. A failed job with a visible reason is the correct outcome
([guardrails.md](guardrails.md)).

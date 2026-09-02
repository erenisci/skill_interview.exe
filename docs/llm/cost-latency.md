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

| Task              | Input                                           | Output                                        |
| ----------------- | ----------------------------------------------- | --------------------------------------------- |
| Synthesize primer | Retrieved text, truncated to the per-job budget | 1–2 pages                                     |
| Classify          | Card plus source summary                        | Small structured object                       |
| Comparison card   | Two skills' retained sources                    | 1–2 pages                                     |
| Generate question | One card plus sibling facts                     | One question with four options and rationales |
| Explain answer    | Question, options, chosen option                | Short explanation                             |

Retrieved text is truncated rather than summarized by an extra model call: a summarization pass would double the
generation time and add a place for facts to be lost before the writer ever sees them.

**The token budget is bounded by VRAM, not only by prompt length.** The KV cache grows with `num_ctx`, and on a 4 GB
GPU holding a ~2.5 GB model there is little slack: raising the context to fit more source text is exactly what pushes
layers onto the CPU and turns generation from seconds into minutes, silently. Truncation and `num_ctx` are tuned
together — see [../operations/performance.md](../operations/performance.md).

Concrete token limits are TBD until measured on the target GPU — guessing them would put a fabricated number in a
doc that later reads as fact.

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

Measured numbers are TBD until M-2; they depend on the user's hardware, model size, and quantization.

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

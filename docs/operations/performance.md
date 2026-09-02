---
title: Performance
discipline: ops
status: active
updated: 2026-09-02
---

# Performance

> **Purpose.** The budgets this product is designed around, and how each is defended.
> **Related.** [../architecture/adr/0001-initial-architecture.md](../architecture/adr/0001-initial-architecture.md) · [../llm/cost-latency.md](../llm/cost-latency.md)

Performance is a stated product requirement here, not a nice-to-have — the app was specified as "must not eat RAM"
while also running a local model. This document holds the numbers that requirement turns into.

## Targets

Two paths with completely different budgets. Keeping them separate is the entire architecture.

| Path                                   | Memory                                            | Latency                                                 |
| -------------------------------------- | ------------------------------------------------- | ------------------------------------------------------- |
| **Read** — daily set, cards, answering | App baseline only; the model must not be resident | Cold start to daily set under 3 s; interactions instant |
| **Generation** — researching a skill   | App baseline + the model (~2.5 GB for `qwen3:4b`) | Minutes, asynchronous, never blocking the UI            |

| Budget                                     | Target                                                                            | Status     |
| ------------------------------------------ | --------------------------------------------------------------------------------- | ---------- |
| Electron baseline                          | ~200 MB, accepted in [ADR-0001](../architecture/adr/0001-initial-architecture.md) | Accepted   |
| App overhead above baseline during reading | Small — a UI that inflates this is a defect, not a regression to triage later     | To measure |
| Resident memory after the queue drains     | Back to baseline; model released                                                  | Required   |
| Cold start to daily set                    | < 3 s on a mid-range machine                                                      | To measure |
| Daily-set query                            | Indexed; no table scan                                                            | Required   |

Numbers marked "to measure" are TBD until M-5. They will be measured rather than guessed — a fabricated budget in a
doc is worse than an honest gap.

## Bottlenecks

| Bottleneck               | Nature                                            | Handling                                                                                 |
| ------------------------ | ------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| **Model memory**         | ~2.5 GB of VRAM while a job runs                  | The dominant cost. Serial jobs, model released when the queue drains                     |
| **Generation time**      | Minutes per skill                                 | Moved off the user's critical path entirely; progress is visible                         |
| **Electron baseline**    | ~200 MB, fixed                                    | Accepted; no headroom, so UI weight is watched ([TD-05](../project/tech-debt.md))        |
| **Relation computation** | O(n²) worst case if every skill shares a category | Incremental — only the changed skill's category is touched; comparisons capped per skill |
| **Review table growth**  | Fastest-growing table                             | Append-only, indexed on `(item_type, item_id, due_at)`                                   |
| **FTS5 index**           | Grows with card count                             | Well within SQLite's range for one user's library                                        |

The honest framing: during generation the model is more than ten times the app's entire footprint. Optimizing the
shell would be pointless. **The two performance decisions that matter are that the model is not resident while the
user is reading, and that it stays entirely on the GPU while it is** — both structural, neither an optimization.

## Budgets

Rules that hold regardless of measured numbers:

1. **The read path touches SQLite only.** No model call, no HTTP request, in any code path the daily set reaches.
   Checked in [../engineering/self-review-checklist.md](../engineering/self-review-checklist.md).
2. **One LLM job at a time.** Parallelism doubles the resident memory for no user-visible gain.
3. **The model is released when the queue drains.** This is the memory design, not an optimization to defer.
   Concretely: Ollama keeps a model resident for about five minutes by default, so the adapter passes `keep_alive`
   explicitly — a short window during a job run, and `0` from `release()` once the queue empties. Removing that call
   silently reintroduces a multi-gigabyte idle footprint, which no test would catch.
4. **The model must stay fully on the GPU.** Partial CPU offload turns generation from seconds into minutes, and it
   happens silently. See below — this constrains the token budget, not just the model choice.
5. **Every daily-path query has an index.** A new query without one is a review failure.
6. **UI weight is a defect, not a trade-off.** With no headroom above the Electron baseline, a heavy dependency in the
   renderer breaks a product requirement.
7. **Generation may be slow; it may never block.** Users tolerate minutes of background work and do not tolerate a
   frozen window.

## GPU residency

Ollama offloads to CUDA automatically when it can, and **falls back to a CPU/GPU split when it cannot** — without
erroring, and without anything in this app noticing. The symptom is generation that used to take seconds taking
minutes.

What consumes VRAM is not only the weights:

```text
VRAM  =  model weights  +  KV cache (grows with num_ctx)  +  overhead
```

On the 4 GB development GPU, `qwen3:4b` at Q4 is ~2.5 GB of weights, which leaves little room. That makes the
**context window a performance decision, not just a prompt-budget one**: raising `num_ctx` to fit more retrieved
source text is exactly what pushes layers onto the CPU. The two must be tuned together, and the retrieval truncation
budget in [../llm/cost-latency.md](../llm/cost-latency.md) is bounded by this, not only by prompt length.

Rules:

- `num_ctx` is set explicitly by the adapter, never left to the runtime's default.
- After any change to the token budget, the model, or quantization, **verify the split** — `ollama ps` reports
  `100% GPU` when fully offloaded and something like `48%/52% CPU` when not.
- Log the generation duration per stage so a silent fall back to CPU shows up as a timing regression
  ([logging.md](logging.md)).
- Checked before every release ([../quality/qa-checklist.md](../quality/qa-checklist.md)).

Concrete `num_ctx` and truncation values are TBD until measured on the target GPU.

## Measurement

- Memory sampled at three points: idle after start, peak during generation, and after the queue drains. The third is
  the one that proves the design works.
- Cold start timed from launch to the daily set rendering.
- Generation timings logged per stage, so slowness is attributable to retrieval or to the model
  ([logging.md](logging.md)).
- Verified per release on the clean VM ([../quality/qa-checklist.md](../quality/qa-checklist.md)), not only on the
  development machine.

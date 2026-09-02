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
while also running a local 8B model. This document holds the numbers that requirement turns into.

## Targets

Two paths with completely different budgets. Keeping them separate is the entire architecture.

| Path                                   | Memory                                            | Latency                                                 |
| -------------------------------------- | ------------------------------------------------- | ------------------------------------------------------- |
| **Read** — daily set, cards, answering | App baseline only; the model must not be resident | Cold start to daily set under 3 s; interactions instant |
| **Generation** — researching a skill   | App baseline + the model (~5 GB for an 8B Q4)     | Minutes, asynchronous, never blocking the UI            |

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
| **Model memory**         | ~5 GB resident while a job runs                   | The dominant cost. Serial jobs, model released when the queue drains                     |
| **Generation time**      | Minutes per skill                                 | Moved off the user's critical path entirely; progress is visible                         |
| **Electron baseline**    | ~200 MB, fixed                                    | Accepted; no headroom, so UI weight is watched ([TD-05](../project/tech-debt.md))        |
| **Relation computation** | O(n²) worst case if every skill shares a category | Incremental — only the changed skill's category is touched; comparisons capped per skill |
| **Review table growth**  | Fastest-growing table                             | Append-only, indexed on `(item_type, item_id, due_at)`                                   |
| **FTS5 index**           | Grows with card count                             | Well within SQLite's range for one user's library                                        |

The honest framing: during generation the model is 25× the app's entire footprint. Optimizing the shell would be
pointless. **The only performance decision that matters is that the model is not resident while the user is reading** —
and that is structural, not an optimization.

## Budgets

Rules that hold regardless of measured numbers:

1. **The read path touches SQLite only.** No model call, no HTTP request, in any code path the daily set reaches.
   Checked in [../engineering/self-review-checklist.md](../engineering/self-review-checklist.md).
2. **One LLM job at a time.** Parallelism doubles the resident memory for no user-visible gain.
3. **The model is released when the queue drains.** This is the memory design, not an optimization to defer.
   Concretely: Ollama keeps a model resident for about five minutes by default, so the adapter passes `keep_alive`
   explicitly — a short window during a job run, and `0` from `release()` once the queue empties. Removing that call
   silently reintroduces a multi-gigabyte idle footprint, which no test would catch.
4. **Every daily-path query has an index.** A new query without one is a review failure.
5. **UI weight is a defect, not a trade-off.** With no headroom above the Electron baseline, a heavy dependency in the
   renderer breaks a product requirement.
6. **Generation may be slow; it may never block.** Users tolerate minutes of background work and do not tolerate a
   frozen window.

## Measurement

- Memory sampled at three points: idle after start, peak during generation, and after the queue drains. The third is
  the one that proves the design works.
- Cold start timed from launch to the daily set rendering.
- Generation timings logged per stage, so slowness is attributable to retrieval or to the model
  ([logging.md](logging.md)).
- Verified per release on the clean VM ([../quality/qa-checklist.md](../quality/qa-checklist.md)), not only on the
  development machine.

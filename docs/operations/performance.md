---
title: Performance
discipline: ops
status: active
updated: 2026-09-03
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

| Budget                                     | Target                                                                            | Status       |
| ------------------------------------------ | --------------------------------------------------------------------------------- | ------------ |
| Electron baseline                          | ~200 MB, accepted in [ADR-0001](../architecture/adr/0001-initial-architecture.md) | Accepted     |
| App overhead above baseline during reading | Small — a UI that inflates this is a defect, not a regression to triage later     | To measure   |
| Resident memory after the queue drains     | Back to baseline; model released                                                  | **Verified** |
| Model fully on the GPU during generation   | `ollama ps` reports `100% GPU`                                                    | **Verified** |
| One generation, model warm                 | ~1 s                                                                              | **0.9 s**    |
| One generation, model cold                 | Load plus generation                                                              | **5.1 s**    |
| Cold start to daily set                    | < 3 s on a mid-range machine                                                      | To measure   |
| Daily-set query                            | Indexed; no table scan                                                            | Required     |

Measured on the reference machine with `qwen3:4b`, 4096 context, thinking disabled and all layers forced onto the
GPU. The remaining "to measure" rows wait for M-5 — they will be measured rather than guessed, because a fabricated
budget in a doc is worse than an honest gap.

**How much of that was luck rather than design:** the first honest measurement of this pipeline was **82.8 s** for a
two-sentence card. Two settings, neither of which had been considered when the budgets above were first written,
account for the difference — see the two sections below.

## Bottlenecks

| Bottleneck               | Nature                                            | Handling                                                                                 |
| ------------------------ | ------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| **Reasoning traces**     | ~18 s of invisible tokens per request             | `think: false` on every request — the single largest factor, and the least expected      |
| **Model memory**         | 3.2 GB of VRAM while a job runs                   | Serial jobs, all layers forced onto the GPU, model released when the queue drains        |
| **Generation time**      | ~1 s warm, ~5 s cold per request                  | Off the user's critical path anyway; progress is visible                                 |
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
4. **The model must stay fully on the GPU**, forced with `num_gpu` rather than left to the runtime's estimate.
   Partial offload is silent and costly. Note what measurement showed: lowering the context did **not** fix it —
   that was the intuitive move and the wrong one.
5. **Every daily-path query has an index.** A new query without one is a review failure.
6. **UI weight is a defect, not a trade-off.** With no headroom above the Electron baseline, a heavy dependency in the
   renderer breaks a product requirement.
7. **Generation may be slow; it may never block.** Users tolerate minutes of background work and do not tolerate a
   frozen window.

## The reference machine

Budgets are set against real hardware rather than an imagined average. Measured, not assumed:

|     |                                        |
| --- | -------------------------------------- |
| GPU | RTX 3050 Ti Laptop — **4096 MiB** VRAM |
| RAM | 16 GB                                  |
| CPU | i5-11400H, 6C/12T                      |

This is a common mid-range configuration, which is why it is treated as the target rather than as one machine's
limitation. **VRAM is the only binding constraint here** — system RAM and disk have ample headroom, so any argument
that appeals to them is wrong.

The 4096 MiB is what rules out an 8B model: ~4.7–4.9 GB of Q4 weights before a single byte of KV cache.

## Reasoning traces — the factor nobody was looking for

The recommended model is a hybrid reasoning model, and thinks by default. Same prompt, same schema, warm model:

|                | Total      | Generation | Output    |
| -------------- | ---------- | ---------- | --------- |
| `think: false` | **1.6 s**  | 1.5 s      | 43 tokens |
| thinking on    | **19.6 s** | 2.0 s      | 55 tokens |

Generation time is identical. The difference is a reasoning trace the user never sees, and an earlier uncontrolled
run reached **134 s** — the cost is both large and variable.

None of the model tasks in this pipeline are reasoning problems: writing prose from supplied text, classifying into a
category, and picking a candidate from a short list all have their material already in the prompt. So `think: false`
goes on every request.

Worth keeping as a lesson rather than just a setting: **the bottleneck that was documented at length (GPU residency)
was real but secondary, and the dominant one was not on the list at all.** It only surfaced because the first end-to-end
run was timed instead of assumed.

## GPU residency — measured

Ollama offloads to CUDA automatically, and **falls back to a CPU/GPU split when its own estimate says the model will
not fit** — without erroring, and without anything in this app noticing.

It happened here, and the estimate was too conservative. Measured on the reference machine with `qwen3:4b`:

| Configuration                                | Size       | Processor         |
| -------------------------------------------- | ---------- | ----------------- |
| `num_ctx` 4096, automatic                    | 3.5 GB     | 33% / 67% CPU/GPU |
| `num_ctx` 2048, automatic                    | 3.2 GB     | 27% / 73% CPU/GPU |
| flash attention + KV cache `q8_0`, automatic | 3.1 GB     | 23% / 77% CPU/GPU |
| **`num_ctx` 4096, `num_gpu: 99`**            | **3.2 GB** | **100% GPU**      |

Ollama was leaving **1.6 GB of a 4 GB card unused** while offloading a third of the model to the CPU. Lowering the
context did not fix it and cost capability for nothing. Asking for more layers than the model has (`num_gpu: 99`)
pins all of them, and full context survives.

So the adapter sends `num_gpu: 99` on every request. The risk is a GPU smaller than the reference one, where forcing
the split could fail to allocate — it is therefore configurable, and a failure surfaces as a configuration error
rather than a silent slowdown.

**Flash attention and KV-cache quantization are a real but secondary lever.** They reduce footprint (3.1 GB against
3.2 GB, and more at larger contexts), which buys context headroom for the retrieval budget in M-2. They are Ollama
_server_ environment variables, so the app cannot set them — they are user-side tuning, documented in
[../onboarding.md](../onboarding.md).

Rules:

- `num_ctx` and `num_gpu` are both set explicitly by the adapter, never inherited.
- After any change to the token budget, the model, or quantization, **verify the split** — `ollama ps` must report
  `100% GPU`.
- Log generation duration per stage so a silent fall back to CPU shows up as a timing regression
  ([logging.md](logging.md)).
- Checked before every release ([../quality/qa-checklist.md](../quality/qa-checklist.md)).

## Context window headroom

`num_ctx: 4096` is not a guess — measured against real prompts and real retrieved text
(`evals/probes/context-probe.mjs`, 2026-09-03):

| Prompt               | Input budget                    | Measured input tokens | Headroom left in the window                      |
| -------------------- | ------------------------------- | --------------------- | ------------------------------------------------ |
| `primer-card`        | 8,000 chars, one source         | ~1,958                | ~46% free, even at the 6,000-char output ceiling |
| `comparison-card`    | 4,000 chars a side, two sources | ~1,874                | ~54% free                                        |
| `contrastive-claims` | 3,000 chars a side, two primers | ~1,992                | ~51% free                                        |
| `resolve-source`     | Up to five candidates' leads    | ~928                  | ~77% free                                        |
| `classify-skill`     | 2,000-char excerpt              | ~926                  | ~77% free                                        |

`primer-card` is the tightest case because retrieved articles run large — PostgreSQL and Kubernetes measured
32,000–39,000 characters before truncation. `num_ctx: 8192` was measured too: it still fits the reference 4 GB card
at 100% GPU (3.8 GB), so it stays documented as an option, but 4096 is the default because that leaves nothing for
anything else running on a 4 GB card.

**Do not raise a truncation budget without re-running this probe.** The source budget and `num_ctx` were sized
together; growing one without the other risks the prompt overflowing the window before the model writes a word,
which the runtime truncates silently rather than reporting.

## Measurement

- Memory sampled at three points: idle after start, peak during generation, and after the queue drains. The third is
  the one that proves the design works.
- Cold start timed from launch to the daily set rendering.
- Generation timings logged per stage, so slowness is attributable to retrieval or to the model
  ([logging.md](logging.md)).
- Verified per release on the clean VM ([../quality/qa-checklist.md](../quality/qa-checklist.md)), not only on the
  development machine.

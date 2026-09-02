---
title: System Design
discipline: code
status: active
updated: 2026-09-02
---

# System Design

> **Purpose.** The design of the parts that carry real complexity: the queue, the pipeline, distractors, and scheduling.
> **Related.** [overview.md](overview.md) · [database-design.md](database-design.md) · [../llm/architecture.md](../llm/architecture.md)

## Requirements

Design-relevant constraints, from [../product/requirements-nfr.md](../product/requirements-nfr.md):

- The model must not be resident during daily use, and the read path must not touch it.
- Killing the app mid-generation must not corrupt state.
- A malformed model output must never reach the user.
- Providers must be swappable without touching pipeline code.
- Distractors must be plausible — this is the product's central quality problem.

## High-Level Design

Three layers, one direction of dependency:

```text
Renderer ──IPC──▶ Services ──▶ Adapters ──▶ Outside world
                     │
                     ▼
                  SQLite
```

The renderer never reaches past IPC. Services never import an adapter's concrete implementation. Adapters know
nothing about the domain — a `SearchAdapter` returns documents, not skills.

## Components

### Job queue

Jobs are rows, not in-memory promises. Each has a kind, a payload, a status, an attempt count, and a last error.

- **Durability.** Status lives in SQLite, so a crash mid-job is recoverable. On startup, rows stuck in `running`
  past a timeout are reset to `pending`.
- **Concurrency.** One LLM job at a time. The model is the bottleneck and the memory cost; parallelism buys nothing
  and doubles the footprint. Retrieval jobs may run in parallel, bounded.
- **Retry.** Three attempts with backoff. After that the job is `failed` and visible in the UI with its error.
- **Model lifecycle.** When the queue drains, the adapter releases the model so Ollama can unload it. This is the
  mechanism behind the memory requirement, not an optimization.

### Pipeline stages

Each stage is a pure-ish function: input state in, output state out, persistence at the boundary. A stage that fails
leaves the job retryable and the database consistent.

| Stage      | Input                | Output                          | Failure                                                                              |
| ---------- | -------------------- | ------------------------------- | ------------------------------------------------------------------------------------ |
| search     | skill name           | **candidates**, not sources     | no candidates → fail the job                                                         |
| resolve    | candidates           | sources                         | nothing passes both gates → fail the job ([ADR-0003](adr/0003-source-resolution.md)) |
| extract    | HTML                 | clean text, truncated to budget | login walls and JS-only pages discarded                                              |
| synthesize | source text          | primer card                     | out-of-band length → one reformat retry; never falls back to model memory            |
| classify   | card + sources       | category, tags                  | low confidence → stored anyway, user-correctable                                     |
| relate     | classified skills    | relation edges                  | none; recomputation is idempotent                                                    |
| generate   | card + sibling facts | question candidates             | malformed JSON → retry, then fail                                                    |
| validate   | candidates           | accepted questions              | rejections are recorded, not silently dropped                                        |

**`search` and `resolve` are separate stages on purpose.** Collapsing them is what makes a pipeline confidently
wrong: a search result is a candidate, and treating it as a source is how "Zustand" ends up grounded in the
Wikipedia article about Pompeii. Resolution applies a free deterministic name gate, then a small model call to
confirm the subject — because an exact title match is not enough when an ancient Crimean people share a name with an
app framework.

Idempotency matters: a job re-run after a crash must not duplicate cards. Writes are keyed on
`(skill_id, kind, prompt_version)` and upsert.

### Distractor assembly

The hardest part of the product, so it is deliberately not left to the model alone.

1. Find the skill's siblings via the relation table.
2. Pull concrete, factual properties from each sibling's stored card and sources — the kind of statement that is true
   of the sibling and false of this skill.
3. Ask the model for the stem, correct option, and rationales; supply the sibling facts as candidate distractors.
4. Validate structurally (see below) and reject anything ambiguous.
5. Only if fewer than three usable distractors exist, allow model-generated ones — and mark them, so the eval suite
   can measure whether they are worse.

Validation rejects: not exactly four options, not exactly one correct, "all/none of the above", duplicate options
after normalization, option lengths outside a bounded ratio, or any option missing a rationale.

### Scheduler

FSRS over rows in the review table. Deliberately a pure function of stored state — no ambient clock reads inside the
algorithm, so it is unit-testable with fixed inputs.

Daily-set assembly: take due items ordered by due date, cap at the user's configured counts, fill any remainder with
new items, and stop. No filler when nothing is due; an empty state is the correct answer.

Day boundaries use the local date computed once per session, so a machine crossing midnight mid-review does not
reshuffle the set underneath the user.

## Trade-offs

| Decision          | Chosen                  | Rejected                      | Why                                                                               |
| ----------------- | ----------------------- | ----------------------------- | --------------------------------------------------------------------------------- |
| Job storage       | SQLite rows             | In-memory queue               | Crash recovery is free; the app is killed often on desktop                        |
| LLM concurrency   | Serial                  | Parallel                      | Memory footprint is the constraint the whole design serves                        |
| Distractor source | Sibling skills first    | Model-generated               | Model distractors are implausible or accidentally true                            |
| Relations         | Tag overlap             | Embeddings                    | Cheaper, already available from classification ([TD-03](../project/tech-debt.md)) |
| SQLite driver     | `better-sqlite3` (sync) | `node:sqlite`, async wrappers | Synchronous suits the main process; native rebuild cost accepted                  |
| Validation        | Deterministic code      | LLM-as-judge                  | A second model call inherits the first model's failure modes                      |

## Scaling

Scaling here means one user's library growing, not traffic.

- **Hundreds of skills.** Relations are O(n²) in the worst case if every skill shares a category. Comparison
  generation is capped per skill; relation computation is incremental, touching only the changed skill's category.
- **Thousands of cards and questions.** Well within SQLite's range. FTS5 handles search. The scheduler queries an
  index on due date, not a table scan.
- **Long-running review history.** The review table is the fastest-growing table; it is append-only and indexed by
  `(item_type, item_id, due_at)`.
- **Not designed for.** Multiple users, sync, or a shared corpus. Adding any of those is a redesign, not a setting.

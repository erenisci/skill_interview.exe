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

**M-3 is done.** Research now classifies each skill, recomputes its edges in the graph, and queues a comparison for
every pair strong enough to earn one. Verified live: `nginx` and `Traefik` linked at 0.83 and produced a comparison
naming concrete differences; `nginx` and `PostgreSQL` did not link. 144 tests.

**M-4 is built and measured.** Questions are assembled by code from _claims_: one atomic statement about a skill,
drawn from its card, that never names its own technology. A question about `nginx` is one `nginx` claim plus three
claims belonging to its graph neighbours.

Claims are written **per pair, with both technologies in view** — one call returns what is true of each and false of
the other. That shape was forced by measurement, not chosen: the first design wrote claims about each skill alone and
gated borrowed ones afterwards, which left 1 of 28 standing and produced no questions at all
([ADR-0006](architecture/adr/0006-pairwise-claims.md) supersedes that mechanism; ADR-0004's framing still stands).
Because a pair yields about one usable claim per side, the three wrong answers come from three different
neighbours — which is also the better question, since the confusion spans the CV rather than one entry in it.

The **"bad question" flag always carries a reason**, and a target separating the question from its explanation. A
bare thumbs-down was rejected as unactionable: two correct options is a missing code rule, a wandering explanation is
a prompt problem, and reading every flag as "change the prompt" is the one response that cannot be measured
([ADR-0005](architecture/adr/0005-feedback-as-eval-data.md)).

Writing the tests found a real defect: the generation job legitimately runs more than once per skill — a neighbour
finishing its research re-enqueues it — and the first version rebuilt the same questions from the same claims. It now
skips any claim already asked about, including one whose question the user flagged.

**M-5 is built.** The daily set — FR-40 through FR-44 — is assembled once per local day and frozen
(`daily_set_items`), so reopening the app resumes the same set rather than reassembling around whatever just became
due. Content is not frozen the same way: a question flagged after assembly still disappears, because the read path
re-checks `questions.status` live for every id rather than trusting what was true at assembly time.

Scheduling is [ADR-0007](architecture/adr/0007-fsrs-scheduler.md): FSRS via the `ts-fsrs` library rather than a hand
port — a 21-weight algorithm across seven interdependent formulas is exactly the kind of specialist code this
project has chosen not to reimplement elsewhere (search, extraction, constrained decoding), for the same reason —
run in **long-term mode** (no Anki-style same-day learning steps, which nothing here needs) on a **two-point rating**
rather than the library's usual four, because neither signal this product has is finer than binary: a question's
outcome is correct-or-not, and a card carries no correctness at all. Four golden values were read once from the real
dependency and pinned as regression tests, rather than hand-derived and risking validating the port against its own
misunderstanding.

The reminder (FR-44) is a plain OS notification at a configured time, not a persistent tray icon — no icon asset
exists in the repository yet, and inventing a placeholder felt worse than the honest gap
([TD-16](project/tech-debt.md)). `daily_cards`, `daily_questions` and `reminder_time` — TBD since M-2 — now have real
defaults (`3`, `5`, `18:00`), chosen deliberately but not evidence-based.

## In Progress

- **Neither M-4 nor M-5 has been read end to end in the app yet.** Both are built and covered by tests against
  stubs or a temp database; neither has been watched running against a real model with real skills. M-4: do the
  claims read as specific and the distractors as plausible. M-5: does a real daily set, on screen, feel like a
  reason to open the app tomorrow. 252 tests pass either way — they cover assembly, scheduling, the reminder's
  timing logic, and the transactional answer path, but none of them can answer either question.

## Done (recent)

| Date       | What                                                                                                                       |
| ---------- | -------------------------------------------------------------------------------------------------------------------------- |
| 2026-09-02 | [ADR-0002](architecture/adr/0002-constrained-decoding.md) — JSON Schema at the runtime, plus a parse                       |
| 2026-09-02 | Search coverage + precision probes (`evals/probes/`) — naive search grounds to the wrong subject                           |
| 2026-09-02 | [ADR-0003](architecture/adr/0003-source-resolution.md) — resolution gates; GitHub primary, DuckDuckGo dropped              |
| 2026-09-02 | Repository made ready for public release; brief archive and Acta registry excluded                                         |
| 2026-09-03 | `think: false` and `num_gpu: 99` added to the adapter after measurement — 82.8 s → 0.9 s, 100% GPU                         |
| 2026-09-03 | **M-1 signed off** — all four exit criteria verified against a real `qwen3:4b`                                             |
| 2026-09-03 | M-2: durable job queue with retry, backoff surviving restarts, and model release on drain                                  |
| 2026-09-03 | M-2: search adapters returning candidates, plus HTML/Markdown extraction                                                   |
| 2026-09-03 | Measured GitHub query strategies — `in:name` from ADR-0003 was wrong; plain relevance scores 7/7 against 6/7               |
| 2026-09-03 | M-2: resolution stage — name gate calibrated against real names, subject check 5/5 on a real model                         |
| 2026-09-03 | M-2: primer synthesis, the research pipeline, and a UI that shows a card with its sources                                  |
| 2026-09-03 | **M-2 signed off** — `nginx` and `Zustand` produce correct, grounded cards against real APIs and a real model              |
| 2026-09-03 | [ADR-0004](architecture/adr/0004-claim-based-questions.md) — claims cross between skills; the gate before borrowing        |
| 2026-09-03 | [ADR-0005](architecture/adr/0005-feedback-as-eval-data.md) — flags carry a reason and reach the model only via measurement |
| 2026-09-03 | M-4: claim generation, discrimination gate, code-assembled questions, and the pure structural validator                    |
| 2026-09-03 | M-4: reasoned flag path — recorded, grouped by prompt version, and out of rotation in one transaction                      |
| 2026-09-03 | Measured the discrimination gate — 1 of 28 distractors survived; more material changed nothing                             |
| 2026-09-03 | [ADR-0006](architecture/adr/0006-pairwise-claims.md) — pairwise claims replace the gate; 6/6 pairs, 4/4 skills askable     |
| 2026-09-03 | M-4: a name used as a claim's subject is stripped rather than dropped, and explanations may not cite option positions      |
| 2026-09-03 | Settled the truncation/`num_ctx` TBD — measured against real prompts and real articles, no overflow at 4096                |
| 2026-09-03 | Wired `SKILL_INTERVIEW_DATA_DIR`; the resolved path is never logged, only whether it was overridden                        |
| 2026-09-03 | Added CI (`.github/workflows/ci.yml`) — install, typecheck, lint, test, compile-only build on Windows runners              |
| 2026-09-03 | [ADR-0007](architecture/adr/0007-fsrs-scheduler.md) — FSRS via `ts-fsrs`, long-term mode, two-point rating                 |
| 2026-09-03 | M-5: daily-set assembly, frozen per local day, content re-checked live on every read                                       |
| 2026-09-03 | M-5: the transactional answer path — schedule and mark-done together, or neither                                           |
| 2026-09-03 | M-5: the reminder — pure timing logic plus the one `Notification` call, once-per-day gated                                 |
| 2026-09-03 | Closed M-9 — superseded by the repository already being public; real use replaces a private 30-day log                     |

## Blocked

- Nothing.

## Next Up

1. Add a few related skills in the app and read both the day's questions (M-4) and the daily set (M-5) end to end —
   the check a probe or a stubbed test cannot make for either
2. M-6 — favourites with notes, Markdown export
3. M-7 — eval harness, and the backlog it exists to settle: TD-11 through TD-14 plus the model-dependence question

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
- **Nothing independently checks that a wrong answer is really wrong** ([TD-12](project/tech-debt.md)). The gate that
  did was measured into the ground and removed; one generation call now carries that judgement alone. The user's
  `ambiguous` flag is the production signal, and its rate per prompt version is what M-7 should watch.
- **A skill needs three researched neighbours before it can be asked about** ([TD-14](project/tech-debt.md)), because
  a pair yields about one usable claim per side. Asking the prompt for more was measured and costs more than it buys.
- **`MAX_LENGTH_RATIO` and the claim-count bounds are still guesses** ([TD-11](project/tech-debt.md)), like the
  primer's length bounds before them — and still unmeasured, because no question survived far enough to exercise
  them. They belong to the eval set rather than to another round of hand-tuning.
- **Resolution treats packaging for a technology as the technology** ([TD-10](project/tech-debt.md)). Contained, not
  fixed: the card survives, the skill goes unclassified, nothing false is claimed. Belongs to the eval harness.
- **Whether a two-point rating schedules as well as FSRS's usual four** ([TD-15](project/tech-debt.md)) is unmeasured
  — a deliberate trade-off, since neither signal this product has is finer than binary, but untested against real
  review patterns.
- **The reminder has no persistent tray icon** ([TD-16](project/tech-debt.md)), only a plain notification — no icon
  asset exists yet. Naturally M-8 work, once the installer needs one anyway.

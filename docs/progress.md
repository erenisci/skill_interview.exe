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

## In Progress

- **M-4 works, and has not been read end to end in the app yet.** The first live run failed the milestone: the
  separate discrimination gate left **1 of 28** borrowed claims standing and no question could be assembled. The
  obvious hypothesis was wrong — more material changed nothing — and probing unambiguous cases found the real cause:
  the gate rejects only where the material explicitly contradicts a claim, and material about one technology is
  silent about nearly everything another one does.

  Replaced by pairwise generation ([ADR-0006](architecture/adr/0006-pairwise-claims.md)): both technologies in view,
  one call per pair, separation decided while writing rather than filtered afterwards. Re-measured on four reverse
  proxies — the hardest case — **6 of 6 pairs separated and 4 of 4 skills became askable**.

  Two smaller findings came from the same runs and are now code. A name used as the sentence's subject is stripped
  rather than dropped: "nginx handles more than 10,000 connections" was the commonest way a correct claim arrived
  unusable, and that is a prefix, not a flaw. And the explanation prompt may no longer refer to an option by
  position, because options are shuffled after it writes — every explanation in the first good run said "the first
  option describes…" and would have been wrong on screen.

  What is left is reading them in the app. 203 tests.

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

## Blocked

- Nothing.

## Next Up

1. Add three or four related skills in the app and read the questions — the last M-4 check a probe cannot make
2. Add the CI workflow described in [operations/ci-cd.md](operations/ci-cd.md); no pipeline exists yet

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

---
title: Progress
discipline: project
status: active
updated: 2026-09-05
---

# Progress

> **Purpose.** Where the project actually stands right now. Kept current by `/acta:track`.
> **Related.** [project/roadmap.md](project/roadmap.md) · [../CHANGELOG.md](../CHANGELOG.md)

## Current Status

**Every milestone is built, the app has been read end to end by a person, and the judged eval metrics are scored for
the first time.** 421 tests, type check and build green; the deterministic eval at 100% on every metric, and the
three judged ones now scored — see below for why that number is thinner than it looks.

What the app does today: a skill is added, researched from GitHub, its declared documentation and Wikipedia, and
written up as a grounded primer card with its sources. Skills are classified and linked, and a pair sharing a
category gets a comparison card. **A skill is asked about whether or not it has a neighbour** — contrast questions
where there is one, questions from its own material where there is not. FSRS serves a small daily set, spread across
skills, reading as a card followed by the questions drawn from it. Anything can be kept, grouped the same way, and
exported. Settings, an installer, a tray icon, close-to-tray and an optional Windows login item are in.

**The product is English-only.** Turkish was built, measured and withdrawn — the one scope decision reversed
([TD-19](project/tech-debt.md)).

**Two measurements matter more than any green tick here.**

The judged metrics scored 3/3, 4/4 and 4/4, and groundedness was _checked_ rather than judged: all 41 specific
assertions across three cards were looked for in their frozen source and all 41 were there. Nothing invented. That is
the rule the product would die without, and it holds.

The questions are a different story. Of seven generated live on the same model, **three were flawed** — one with a
correct answer that was wrong, one with three correct options. The mechanical checks passed all of them, because
nothing checks that a wrong answer is wrong ([TD-12](project/tech-debt.md), [TD-25](project/tech-debt.md)).

And the ceiling on all of it is retrieval, not the prompt: **52% to 71% of a retrieved article is provenance** —
dates, licences, sponsors — and Redis's article reaches none of persistence, eviction, replication or pub/sub
([TD-24](project/tech-debt.md)). Trivia in the output had been treated as a prompt failure for two milestones; the
model was answering faithfully from a company history.

## In Progress

- **Nothing blocking.** The app has been run, read and approved; the eval is scored. What is open is measured and
  recorded rather than unknown.

## Done (recent)

| Date       | What                                                                                                                 |
| ---------- | -------------------------------------------------------------------------------------------------------------------- |
| 2026-09-04 | M-7: the eval harness — frozen sets through the shipped pipeline, judged metrics left to a person                    |
| 2026-09-04 | M-8: settings screen, Windows installer, tray icon, CI package job                                                   |
| 2026-09-04 | `resolve-source.v2` — say what qualifies, judge every candidate first. Live 1/6 → 5/6, frozen 7/7                    |
| 2026-09-04 | Fixed a question queue that grew without bound ([TD-21](project/tech-debt.md)) — 1,098 rows on a real machine        |
| 2026-09-04 | Dropped the three-neighbour rule ([TD-14](project/tech-debt.md)) — a CV does not grow on request                     |
| 2026-09-04 | Withdrew Turkish ([TD-19](project/tech-debt.md)) — measured twice, neither fix moved it                              |
| 2026-09-04 | Close-to-tray, Windows login item, new palette, no scrollbar shift; the reminder now actually reaches Windows        |
| 2026-09-05 | `self-questions.v1` — a skill is asked about on its own. Stem first, measured 14/17 against 8/12 for the alternative |
| 2026-09-05 | Today and Kept both read as a card followed by its questions; a question can be kept on its own                      |
| 2026-09-05 | Measured that material is 52–71% provenance ([TD-24](project/tech-debt.md)) — the real ceiling on question quality   |
| 2026-09-05 | First scored judged eval: groundedness 3/3 with all 41 assertions verified against source                            |

Older entries live in the [CHANGELOG](../CHANGELOG.md).

## Blocked

- Nothing.

## Next Up

1. Write the E2E suite. Every defect found on 2026-09-04 and 2026-09-05 was reachable only by opening the window,
   which is exactly what this layer automates — and the flows are now settled enough to be worth pinning
2. Read the flag data once there is some. `ambiguous` and `wrong-answer` rates per prompt version are the production
   signal for [TD-25](project/tech-debt.md), and the only measurement that can close it
3. Decide the retrieval question in [TD-24](project/tech-debt.md): which pages beyond a documentation homepage may
   ground a card. It touches rule 2, so it is a decision before it is code

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
  `ambiguous` flag is the production signal, and its rate per prompt version is what the eval harness should watch.
- **`MAX_LENGTH_RATIO` and the claim-count bounds are still guesses** ([TD-11](project/tech-debt.md)), like the
  primer's length bounds before them — and still unmeasured, because no question survived far enough to exercise
  them. They belong to the eval set rather than to another round of hand-tuning.
- **Claims come back as trivia because the material is trivia** ([TD-24](project/tech-debt.md)). Treated as a prompt
  problem for two milestones; measured at 52-71% provenance in the retrieved article. A code filter contains the
  symptom, and the cause is retrieval.
- **Whether a two-point rating schedules as well as FSRS's usual four** ([TD-15](project/tech-debt.md)) is unmeasured
  — a deliberate trade-off, since neither signal this product has is finer than binary, but untested against real
  review patterns.

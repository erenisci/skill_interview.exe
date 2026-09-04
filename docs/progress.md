---
title: Progress
discipline: project
status: active
updated: 2026-09-04
---

# Progress

> **Purpose.** Where the project actually stands right now. Kept current by `/acta:track`.
> **Related.** [project/roadmap.md](project/roadmap.md) · [../CHANGELOG.md](../CHANGELOG.md)

## Current Status

**Every milestone is built, and the first real session with the app found seven defects that no test had.** M-1
through M-3 were signed off earlier; M-4 through M-8 are built and covered by tests. M-9 is closed as superseded.
380 tests, type check, lint and build green, and the eval suite at 100% on every deterministic metric.

What the app does today: a skill is added, researched from GitHub, its declared documentation and Wikipedia, and
written up as a grounded primer card with its sources. Skills are classified and linked, and a strongly related pair
gets a comparison card. Questions are assembled by code from atomic claims — the right answer is the skill's own, the
three wrong ones belong to three of the user's other skills. FSRS serves a small daily set, spread across skills and
frozen per local day. Anything in it can be starred with a note and exported as Markdown. Settings, an installer, a
tray icon, close-to-tray and an optional Windows login item are in.

**The product is English-only.** Turkish was built, measured and withdrawn — the one scope decision this project has
reversed ([TD-19](project/tech-debt.md)).

The per-milestone story — including the measurements that overturned three confident designs — is in
[project/roadmap.md](project/roadmap.md) and the [CHANGELOG](../CHANGELOG.md); the decisions are in the
[ADRs](architecture/adr/README.md).

**The lesson of 2026-09-04 is worth stating plainly.** Five milestones were green on 337 tests, and the first hour of
someone actually using the app produced: a name gate that discarded the right Wikipedia article and kept the wrong
one, a resolution prompt that refused all six languages tried, a job queue that grew without bound, claims answering
in the wrong language, a daily set frozen at half its size, a misleading empty state, and a rule requiring three
related skills that a real CV cannot satisfy. None of them was subtle. None of them was reachable from a test that
does not open the window.

What is left is the same shape: the judged eval metrics are generated and waiting on a person, and nobody has yet
read a day's questions on screen.

## In Progress

- **M-4, M-5 and M-6 have not been read end to end in the app yet.** The blocking defects found on 2026-09-04 are all
  fixed, so the run is now possible; it has not been done. M-4: do the claims read as specific and the distractors as
  plausible. M-5: does a real daily set, on screen, feel like a reason to open the app tomorrow. M-6: does the
  exported Markdown read well in an editor. No test can answer any of those three.

## Done (recent)

| Date       | What                                                                                                                |
| ---------- | ------------------------------------------------------------------------------------------------------------------- |
| 2026-09-03 | [ADR-0007](architecture/adr/0007-fsrs-scheduler.md) — FSRS via `ts-fsrs`, long-term mode, two-point rating          |
| 2026-09-03 | Closed M-9 — superseded by the repository already being public                                                      |
| 2026-09-03 | M-6: favourites with notes and Markdown export, grouped by skill                                                    |
| 2026-09-04 | M-7: the eval harness — frozen sets through the shipped pipeline, judged metrics left to a person                   |
| 2026-09-04 | M-8: settings screen, Windows installer, tray icon, CI package job                                                  |
| 2026-09-04 | First live session: the name gate kept the Indonesian island and discarded the Java language. Fixed, 5 languages    |
| 2026-09-04 | `resolve-source.v2` — say what qualifies, judge every candidate first. Live 1/6 → 5/6, frozen 7/7                   |
| 2026-09-04 | Fixed a question queue that grew without bound ([TD-21](project/tech-debt.md)) — 1,098 rows on a real machine       |
| 2026-09-04 | Dropped the three-neighbour rule ([TD-14](project/tech-debt.md)) — a CV does not grow on request                    |
| 2026-09-04 | The daily set spreads across skills and tops up slots it never filled; per-skill limits on the skill's own page     |
| 2026-09-04 | Withdrew Turkish ([TD-19](project/tech-debt.md)) — measured twice, neither fix moved it. English-only, deliberately |
| 2026-09-04 | Close-to-tray, optional Windows login item, new palette, expand animation, no scrollbar shift                       |

Older entries live in the [CHANGELOG](../CHANGELOG.md).

## Blocked

- Nothing.

## Next Up

1. Add four or five skills in the app and read the day's questions (M-4), the daily set (M-5) and an export (M-6)
   end to end — the check a probe or a stubbed test cannot make for any of them
2. Score the judged eval metrics (`evals/results/`) — groundedness, distractor plausibility, ambiguity are generated
   and waiting, and they are the only measurements that say anything about quality
3. Write the E2E suite, once those two have confirmed the flows are the right ones. Everything found on 2026-09-04
   was reachable only by opening the window, which is exactly what this layer would automate

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
- **Claims still come back as trivia** ([TD-13](project/tech-debt.md)) more often than as the distinctions that
  matter. Contained by validation, not solved by it.
- **Whether a two-point rating schedules as well as FSRS's usual four** ([TD-15](project/tech-debt.md)) is unmeasured
  — a deliberate trade-off, since neither signal this product has is finer than binary, but untested against real
  review patterns.

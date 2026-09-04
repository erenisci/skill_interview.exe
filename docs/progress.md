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

**Every milestone is built. M-1 through M-3 are signed off against real APIs and a real model; M-4 through M-8 are
built and covered by tests but have not been watched running by a person. M-9 is closed as superseded.** 337 tests,
type check, lint and build green.

What the app does today: a skill is added, researched from GitHub, its declared documentation and Wikipedia, and
written up as a grounded primer card with its sources. Skills are classified and linked, and a strongly related pair
gets a comparison card. Questions are assembled by code from atomic claims — the right answer is the skill's own, the
three wrong ones belong to three different neighbours. FSRS serves a small daily set, frozen per local day. Anything
in it can be starred with a note and exported as Markdown. Settings, an installer, and a tray icon are in.

The per-milestone story — including the measurements that overturned three confident designs — is in
[project/roadmap.md](project/roadmap.md) and the [CHANGELOG](../CHANGELOG.md); the decisions are in the
[ADRs](architecture/adr/README.md).

**Two things about that status are worth stating plainly.** The remaining work is almost entirely _looking at it_
rather than building it: five milestones are green on tests that, by construction, cannot answer whether the content
is any good. And the eval harness — the one thing that can — has produced its judged material and is waiting on a
human to score it.

## In Progress

- **M-4, M-5 and M-6 have not been read end to end in the app yet.** All three are built and covered by tests against
  stubs or a temp database; none has been watched running against a real model with real skills. M-4: do the claims
  read as specific and the distractors as plausible. M-5: does a real daily set, on screen, feel like a reason to open
  the app tomorrow. M-6: does the exported Markdown read well in an editor. The tests cover assembly, scheduling, the
  reminder's timing logic, the transactional answer path and the export renderer, and none of them can answer any of
  those three questions.

## Done (recent)

| Date       | What                                                                                                                   |
| ---------- | ---------------------------------------------------------------------------------------------------------------------- |
| 2026-09-03 | [ADR-0006](architecture/adr/0006-pairwise-claims.md) — pairwise claims replace the gate; 6/6 pairs, 4/4 skills askable |
| 2026-09-03 | [ADR-0007](architecture/adr/0007-fsrs-scheduler.md) — FSRS via `ts-fsrs`, long-term mode, two-point rating             |
| 2026-09-03 | M-5: daily-set assembly frozen per local day, with content re-checked live on every read                               |
| 2026-09-03 | Closed M-9 — superseded by the repository already being public; real use replaces a private 30-day log                 |
| 2026-09-03 | `SwappableLlmAdapter` — selecting a model swaps the live adapter in place, no restart                                  |
| 2026-09-03 | M-6: favourites with notes, kept as tombstones when their skill is deleted; Markdown export grouped by skill           |
| 2026-09-04 | M-7: the eval harness — six frozen sets through the shipped pipeline, judged metrics left to a person                  |
| 2026-09-04 | First eval run found a two-milestone-old bug: `resolve-source` answered before reasoning. 1/4 → 7/7, closing TD-10     |
| 2026-09-04 | Recorded TD-17 and TD-18 as failing baselines, then fixed both — grounding guard, and the language stated last         |
| 2026-09-04 | M-8: settings screen with main-process validation, Windows installer, tray icon (closing TD-16), CI package job        |

Older entries live in the [CHANGELOG](../CHANGELOG.md).

## Blocked

- Nothing.

## Next Up

1. Add a few related skills in the app and read both the day's questions (M-4) and the daily set (M-5) end to end —
   the check a probe or a stubbed test cannot make for either
2. Install from `release/` on a clean Windows machine and walk to a daily set — M-8's exit criterion, and the only
   check that cannot be run from inside the repository
3. Score the judged eval metrics (`evals/results/`) — groundedness, distractor plausibility, ambiguity are generated
   and waiting, and they are the ones that say something about quality

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
- **A skill needs three researched neighbours before it can be asked about** ([TD-14](project/tech-debt.md)), because
  a pair yields about one usable claim per side. Asking the prompt for more was measured and costs more than it buys.
- **`MAX_LENGTH_RATIO` and the claim-count bounds are still guesses** ([TD-11](project/tech-debt.md)), like the
  primer's length bounds before them — and still unmeasured, because no question survived far enough to exercise
  them. They belong to the eval set rather than to another round of hand-tuning.
- **Claims still come back as trivia** ([TD-13](project/tech-debt.md)) more often than as the distinctions that
  matter. Contained by validation, not solved by it.
- **Whether a two-point rating schedules as well as FSRS's usual four** ([TD-15](project/tech-debt.md)) is unmeasured
  — a deliberate trade-off, since neither signal this product has is finer than binary, but untested against real
  review patterns.

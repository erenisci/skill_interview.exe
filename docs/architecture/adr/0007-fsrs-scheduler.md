---
title: 'ADR 0007: FSRS via ts-fsrs, in long-term mode, on a two-point rating'
discipline: code
status: Accepted
date: 2026-09-03
---

# ADR 0007: FSRS via ts-fsrs, in long-term mode, on a two-point rating

## Status

Accepted — 2026-09-03

## Context

M-5 needed a spaced-repetition scheduler: FR-41 requires that reviewed items reappear per an
FSRS interval, not at random. Three questions had to be settled before any code could be
written, and none of them is "which product feature" — they are "which specific version of a
specialist algorithm, run in which mode, fed by which signal."

**Hand-port the algorithm, or depend on a library?** FSRS-6 is 21 tuned weights across seven
formulas — a mean-reverting difficulty update, a stability update that differs for a lapse
versus a success, an exponential retrievability curve. Porting that by hand risks the exact
failure this product exists to avoid elsewhere: confident, wrong output that no test catches
because the test was written against the same misreading of the formula as the code.

**Which FSRS mode?** The library's default mode adds an Anki-style minute-scale learning-step
state machine for same-day re-review — new cards step through 1-minute and 10-minute
intervals before entering the long-term schedule. This product shows an item once per day as
part of the daily set; there is no same-day re-review to schedule.

**What rating does the app actually have?** FSRS is built for a self-graded four-point scale
(again/hard/good/easy) — the reader rates their own recall. This product does not collect
that. A question's signal is binary: the option picked was correct, or it was not. A card has
no correctness signal at all, only "the user looked at it."

## Decision

**Depend on `ts-fsrs` (pinned `5.4.2`, MIT, zero runtime dependencies of its own), used only
from `src/main/scheduler/fsrs.ts` — the same one-file boundary discipline as `llm/ollama.ts`
and the search adapters. Nothing outside that file imports the library or sees its `Card`
shape.**

Configured `enable_short_term: false, enable_fuzz: false`. This is a supported, documented
FSRS configuration ("long-term mode"), not an invented shortcut — and it is what the schema
already commits to: the `reviews` table (migration 001) has no column for a learning-step
counter or a card state enum, only `due_at`, `stability`, `difficulty`, `reps`, `lapses`.

**Two ratings — `again` and `good` — not the library's four.** A question maps its outcome
directly: the picked option correct → `good`, incorrect → `again`. A card offers two buttons
with the same two meanings ("Needed review" / "Knew it"). `hard` and `easy` are never
produced, because nothing in the product measures the distinction they would require —
offering four buttons over a two-valued signal would be decoration, not data.

`ts-fsrs`'s own `next(card, now, grade)` does the actual scheduling; the wrapper only
translates our domain shapes (`PriorReview` in, `ScheduledReview` out) to and from its `Card`,
and keeps `now` as a parameter rather than reading the clock internally, matching
[system-design.md](../system-design.md)'s "no ambient clock reads inside the algorithm."

## Alternatives considered

**Hand-port the algorithm.** Rejected for the reason in Context: a subtly wrong formula would
be invisible to any test written from the same understanding that produced the bug, and this
is exactly the kind of specialist, actively-researched algorithm a focused library does
better than a one-off reimplementation — the same trade this product already makes for
search, extraction, and constrained decoding.

**Use the library's default short-term/learning-step mode.** Rejected — it exists to schedule
same-day re-review, which this product's one-item-per-day daily set never does, and it would
add card state (`New`/`Learning`/`Review`/`Relearning`) and a learning-step counter to the
schema for a mechanism nothing here exercises.

**Ask the reader to self-grade on four points anyway**, prompting "how well did you know
this?" after every card and question. Rejected as friction the product does not need to add:
a question already produces a real, non-self-reported difficulty signal (correct/incorrect),
and inventing a subjective one on top of it would be asking for data this product has no way
to act on differently from the binary signal it already has.

**Store the library's richer `Card` state** (state enum, elapsed/scheduled days, learning
steps) in the `reviews` table for future flexibility. Rejected — columns for a mode this
product does not run are dead weight and a temptation to half-implement short-term scheduling
later without deciding to. The schema stores exactly what long-term mode produces.

## Consequences

**Easier.**

- Four pinned "golden" outputs, read once from the real dependency rather than hand-derived,
  catch a silent behaviour change on a `ts-fsrs` upgrade without re-deriving the math
  (`fsrs.test.ts`).
- The scheduler is genuinely pure and trivially testable: fixed dates in, fixed state out, no
  database, no Electron.
- `reviews.rating` stores the library's own `Rating` enum values (`again` = 1, `good` = 3)
  rather than an app-invented 0/1, so a later export lines up with what FSRS itself means by
  the number.

**Harder.**

- **A card's rating carries no information beyond "I looked at this."** There is no way to
  tell FSRS "I sort of remembered this" versus "I remembered this instantly" for a card —
  both collapse to `good`. If real use shows cards need finer signal than questions do, that
  is a UI change (more buttons), not a scheduler change, since the wrapper already accepts
  any `ReviewRating`.
- **The four-to-two collapse throws away `hard` and `easy`'s tuning.** FSRS's weights were
  fit expecting all four ratings to appear; using only the extremes is a supported mode but an
  under-exercised one. Unmeasured — real use, not a private trial, is what would surface
  whether it matters ([TD-15](../../project/tech-debt.md)).
- One more runtime dependency, `ts-fsrs` — accepted deliberately, per the "depend on a
  focused library" argument above, but it is still a supply-chain surface this product did
  not have before.
- `S_MIN = 0.001` and the library's other internal clamps are trusted rather than re-derived;
  if a future `ts-fsrs` major version changes them, only the pinned exact version
  (`5.4.2`, not a caret range) protects against a silent behaviour shift.

**At scale.** One scheduling call per answer, against in-memory arithmetic — no measurable
cost at any library size this product will ever reach.

<!-- ADRs are per-item and immutable except Status. To change a decision, add a new ADR that supersedes this one. -->

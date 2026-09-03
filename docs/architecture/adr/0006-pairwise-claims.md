---
title: 'ADR 0006: Pairwise claims, separated during generation'
discipline: code
status: Accepted
date: 2026-09-03
---

# ADR 0006: Pairwise claims, separated during generation

## Status

Accepted — 2026-09-03. Supersedes the claim and gating mechanism of
[ADR-0004](0004-claim-based-questions.md); that ADR's framing — a claim as the unit that crosses between skills,
dropping rather than padding, and a pure structural validator — stands unchanged.

## Context

ADR-0004 wrote claims about each skill alone, then used a separate model call to decide whether a borrowed claim was
false of the target before it could be a wrong answer. Measured against `qwen3:4b` on nginx, HAProxy and Apache, that
gate left **1 of 28** claims standing and no question could be assembled at all.

The cause was specific, and it was in the prompt I wrote. The gate rejects a claim only when the material
**explicitly contradicts** it — correctly keeping "uses the process name httpd" and "is released under the Apache
License 2.0", because the nginx material names `nginx` and BSD-2-Clause. Where the material is merely silent it
answers "could be true", in its own words because "the material does not indicate that it does not have this
capability". Material about one technology is silent about nearly everything a different technology does, so the
instruction _"if the material does not settle it, answer true"_ — written to protect against the two-correct-options
failure — rejected almost every distractor instead.

Giving the gate more material was tested and changed nothing (3%). The problem is not thin material; it is that
asking "could this be true of X?" against material about X lets the model reason only from absence.

A second failure showed in the same run. Asked for claims about HAProxy with no neighbour in view, the model returned
what the whole category shares — "supports HTTP/2", "event-driven architecture", "SSL/TLS termination". Those are
genuinely true of nginx, so the gate rejecting them was correct. Both failures have one root: **each technology was
being judged alone.**

## Decision

**Claims are written per pair, with both technologies in view, in a single call.**

`contrastive-claims` receives both skills and both primers and returns what is true of each and false of the other.
Separation is now a property of generation rather than a filter applied afterwards, and there is no discrimination
gate — `question-claims.v1.md` and `discriminate-claim.v1.md` are deleted rather than left as dead prompts.

This puts the model in the situation it demonstrably handles: the comparison card already names concrete differences
between two named tools. Naming the difference is the same act as writing the distractor.

Three consequences follow, and each was forced by a measurement rather than chosen up front:

**A claim is stored with what it is false of.** `claims.contrast_skill_id` is the whole safety argument for showing
one as a wrong answer, so it is a column rather than an implication. The pool for a question about A is exactly
"claims written to be false of A".

**Distractors are pooled across neighbours, not taken three at a time from one.** A pair of near-identical tools
yields roughly one solid separating claim per side. Pushing the prompt for four per side does produce four — and
they name their own technology and stop separating, so the count is illusory. Three wrong answers therefore come
from three different neighbours, which is also the better question: the confusion spans the user's skill list rather
than one entry in it.

**A name used as the sentence's subject is stripped, not dropped.** The commonest way a correct claim arrived
unusable was "nginx handles more than 10,000 simultaneous connections" — right content, wrong form. That is a prefix.
A name buried mid-sentence is still dropped, because removing it needs the sentence rewritten and a regex rewrite
turns a grammatical option into a broken one.

## Alternatives considered

**Flip the gate's tie-breaker so silence keeps a claim.** A one-line change, and a trap. The measurement showed the
model cannot distinguish silence from falsity, so it would swing from rejecting everything to accepting everything —
reinstating the two-correct-options failure the gate existed to prevent.

**Ask for more claims per side.** Measured: 1/1 became 4/4, and every one of the four named its own technology while
the separation itself degraded (both sides described as "event-driven"). Quantity bought at the cost of the two rules
that matter is not quantity.

**Give the gate more material.** Measured, and it changed nothing.

**Derive distractors from the comparison card.** Appealing, since that card already names differences and already
exists. Rejected because comparison cards are written only for pairs above the strength threshold, so weaker
neighbours — still perfectly good distractor sources — would contribute nothing.

## Consequences

**Easier.**

- Measured on four reverse proxies, the hardest case: **6 of 6 pairs separated and all 4 skills became askable**,
  against 0 of 4 under the gate.
- One model call per pair replaces one per skill plus one per candidate claim, so the mechanism is also cheaper.
- Wrong answers now span several technologies, which is what the product promised.

**Harder.**

- **A skill needs three researched neighbours before it can be asked about.** Under ADR-0004 one neighbour was
  enough in principle. This is the honest cost of one-claim-per-pair, and it means a user with three skills gets
  cards and no questions until the fourth.
- **Claims are no longer reusable across neighbours.** The pair is the unit, so the number of calls grows with edges
  rather than with skills. Bounded by `MAX_PAIRS_PER_RUN`, and still cheaper than the gate it replaces.
- **One judgement now carries the whole burden.** The gate was a second, separately-verifiable opinion; there is no
  longer one. If the model says a claim is false of the target and it is not, nothing downstream catches it — the
  structural validator checks form, not truth. The production signal for this is the user's `ambiguous` flag
  ([ADR-0005](0005-feedback-as-eval-data.md)), and it is the reason that flag exists.
- **Trivia still leaks through.** The prompt forbids popularity, licensing and process-name facts and the model
  produces them anyway — they separate two technologies perfectly and teach nothing ([TD-13](../../project/tech-debt.md)).
- The probe reports an upper bound: it does not run the structural validator, and at least one measured candidate
  carried a 400-character run-on option that `MAX_LENGTH_RATIO` would reject.

**At scale.** Calls grow with graph edges rather than skills, capped per run. Both are bounded by the user's own CV.

<!-- ADRs are per-item and immutable except Status. To change a decision, add a new ADR that supersedes this one. -->

---
title: 'ADR 0004: Claim-based question assembly'
discipline: code
status: Accepted
date: 2026-09-03
---

# ADR 0004: Claim-based question assembly

## Status

Accepted — 2026-09-03. **One supporting assumption was measured and did not hold; see the correction below.**

## Correction — 2026-09-03

The decision's structure stands. Its assumption that the discrimination gate would leave enough distractors to build
a question **does not**, and the shortfall is not marginal.

Measured with `evals/probes/question-probe.mjs` against `qwen3:4b`, on nginx, HAProxy and Apache HTTP Server — three
tools that do the same job, chosen as the hardest case:

| Target      | Distractors surviving the gate |
| ----------- | ------------------------------ |
| nginx       | 1 / 10                         |
| HAProxy     | 0 / 8                          |
| Apache      | 0 / 10                         |
| **Overall** | **1 / 28 (4%)**                |

Three or more are needed. **No question could be assembled at all.**

Two hypotheses were tested, and the obvious one was wrong. Giving the gate the full source article instead of the
primer changed nothing (3%), so the cause is not that the material is too thin.

The cause is the gate's tie-breaker. Probed on unambiguous cases, it rejects a claim only when the material
**explicitly contradicts** it — it correctly kept "uses the process name httpd" (the material names `nginx`) and "is
released under the Apache License 2.0" (the material names BSD-2-Clause). Where the material is merely silent it
answers "could be true", reasoning in its own words that "the material does not indicate that it does not have this
capability" and "the statement is not clearly false either". It rejected "stores table rows in a write-ahead log" as
possibly true of nginx on those grounds.

Material about one technology is silent about nearly everything a different technology does. So the instruction in
`discriminate-claim.v1.md` — _"If the material does not settle it, answer `true`"_ — written to protect against the
two-correct-options failure, rejects almost every distractor instead. The safe default was the fatal one.

A second, independent problem shows in the same run: asked for claims about HAProxy, the model returned properties
generic to the whole category ("supports HTTP/2 and HTTP/3", "event-driven architecture", "SSL/TLS termination").
Those are genuinely true of nginx, so rejecting them is the gate working correctly. `question-claims.v1.md` asks for
distinguishing claims and did not get them.

Both belong to a successor ADR rather than to edits here. What the measurement settles is that a gate asking "could
this be true?" against material about the target puts the burden where a small model cannot carry it: it can only
ever reason from absence.

## Context

[Rule 3](../../../CLAUDE.md) says distractors come from the user's sibling skills, assembled by code. M-4 had to turn
that sentence into a mechanism, and the sentence alone does not say what is borrowed from a sibling.

The obvious reading — use the sibling's **name** as an option — collapses immediately. "Which of these is nginx?
(a) nginx (b) Traefik…" is not a question. So something more than a name has to cross between skills.

The alternative that suggests itself is to let the model write all four options. That is what most tooling does, and
it fails in two directions at once: a small model asked for three wrong answers writes three obviously wrong ones,
or writes one that is accidentally correct. Neither is detectable by looking at the JSON.

There is also an ordering problem. A question about the first skill the user adds has no neighbours to borrow from,
because nothing else has been researched yet.

## Decision

**A claim is the unit that crosses between skills.**

A claim is one atomic, self-contained factual statement about a skill, written from that skill's primer card, that
**does not name its own technology**. Claims are stored per skill (`claims` table) and reused.

A question about skill A is then assembled by code: one claim about A as the correct option, three claims belonging
to A's graph neighbours as the distractors. The model writes only the stem and the explanation, and is explicitly
told it is not choosing the answer.

This makes the distractors _true statements about something else_ — which is the confusion a real interview probes,
and the reason this product exists rather than being a flashcard generator.

**Every borrowed claim passes a discrimination gate first.** Neighbours are neighbours because they are similar, so
a claim about Traefik may be perfectly true of nginx as well. Used as a wrong answer it produces a question with two
correct options — the worst defect available, because the reader answers correctly and is told they are wrong. Each
candidate is therefore checked against the target skill's own material, and the prompt is written so that
**uncertainty rejects the claim**: a lost distractor costs one option, an ambiguous one costs the reader's trust.

**Too few survivors means no question.** The candidate is dropped, never padded with an invented option.

**The ordering problem is solved by deferral, not by relaxing the rule.** A skill with no neighbour claims yet
succeeds without writing anything, and each run re-enqueues neighbours that have no questions — so the pool fills in
as research completes. Re-enqueueing is bounded by that condition, and by a filter that will not ask about a claim
already asked.

Structural validation is deterministic and pure (`src/main/pipeline/question-validate.ts`): four options, exactly one
correct, no duplicates, no option naming any technology in play, no "all of the above", and no length imbalance —
the oldest tell in multiple choice, where the correct option is the long careful one.

## Alternatives considered

**Let the model write the distractors.** Rejected — this is the failure the product is built to avoid, and it is
undetectable from the output. It is also what makes the skill graph load-bearing rather than decorative.

**Use sibling names as options.** Rejected — produces a definition-matching exercise, not a question about behaviour.

**Generate claims on demand instead of storing them.** Rejected — a claim written for Traefik is exactly what makes an
nginx question hard, so every neighbour would regenerate the same claims. Storing them turns an N×N cost into N.

**Skip the discrimination gate and trust the graph.** Rejected — the graph pairs skills _because_ they are similar,
which is precisely the condition under which a borrowed claim is likely to also be true. The gate is not optional
overhead; it is the price of borrowing.

**Let a short question through with three options.** Rejected — the same reasoning as ADR-0003. Degrading quietly is
worse than producing less.

## Consequences

**Easier.**

- Rule 3 is now literally true and testable: a test asserts every distractor traces to a sibling skill row.
- The distractor pool improves as the user adds skills, with no prompt changes.
- The explanation has something real to say — "the other three describe Traefik, and here is how" is a lesson rather
  than a correction.
- Most quality rules are deterministic code, so they are cheap to test and impossible for a model to talk past.

**Harder.**

- **A question costs several model calls**, not one: claims per skill, one gate call per candidate claim, plus the
  stem. Verdicts are cached per run and claims are written once per skill, but this is materially more work than
  asking a model for a question. It is background work, so it costs time rather than responsiveness.
- **A skill with no neighbours gets no questions at all.** For a user with one skill, or with skills that share
  nothing, the app has cards and nothing else. That is a visible gap, and it is the honest one — the alternative is
  inventing distractors.
- **The gate's conservatism will discard usable distractors.** Deliberate, but it means the drop rate could be high
  enough to starve question generation. Unmeasured, and the first thing M-7 should measure.
- **`MAX_LENGTH_RATIO` and the claim-count bounds are guesses.** They have not been checked against a corpus of real
  generated questions. They belong in the eval set, not in another round of hand-tuning — the mistake ADR-0003's
  correction records.
- Claim quality now bounds question quality. A vague claim ("is widely used") makes a worthless option no downstream
  stage can rescue, so the claim prompt carries the burden of demanding distinctiveness.

**At scale.** Claims are O(skills) rows and the gate is O(candidates) per question, both bounded by the user's own
skill list. Nothing here grows with anything but the CV.

<!-- ADRs are per-item and immutable except Status. To change a decision, add a new ADR that supersedes this one. -->

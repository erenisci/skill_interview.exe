---
title: 'ADR 0005: Feedback is eval data, not training data'
discipline: code
status: Accepted
date: 2026-09-03
---

# ADR 0005: Feedback is eval data, not training data

## Status

Accepted — 2026-09-03

## Context

M-4 gives the user a way to say a question is bad. The question this ADR settles is what happens to that signal —
and the intuitive answer is wrong in a way that would be expensive to discover later.

The intuitive answer is "feed it back to the model": fine-tune, or a LoRA, or accumulate flagged examples into the
prompt automatically. It is worth writing down why none of that fits, because someone will propose it again.

There is a second, subtler question underneath. A thumbs-down says _something is wrong_. It does not say what. And
the causes of a bad question have almost nothing in common:

| What the reader saw           | Where the defect actually is | What fixes it              |
| ----------------------------- | ---------------------------- | -------------------------- |
| Two options are correct       | Discrimination gate          | Code — a validator rule    |
| The wrong options are obvious | Distractor assembly          | Code — neighbour selection |
| The correct answer is wrong   | Grounding                    | The source, or resolution  |
| The explanation wanders       | Prompt                       | A measured prompt change   |
| Too easy, or off-topic        | Prompt                       | A measured prompt change   |

Reading every flag as "change the prompt" would be wrong most of the time, and it is the one response that cannot be
verified afterwards.

## Decision

**Flags are diagnostic data. They reach the model only through a measured prompt change, never automatically.**

Concretely:

- **A flag always carries a reason code**, chosen from a short list, and a `target` separating the question from its
  explanation. A bare thumbs-down is not offered, because it is not actionable.
- **Flagging is recorded and suppression is immediate**, in one transaction. A question the user rejected leaves
  rotation and does not come back — including when the generation job runs again.
- **A flag on the explanation does not suppress the question.** A sound question with a sloppy explanation is a
  different defect, and collapsing the two would blur both signals.
- **Every question carries `model` and `prompt_version`**, so flag counts group by the prompt that produced them.
  This is what makes _"`question-stem.v2` is flagged three times as often as v1"_ a sayable, checkable sentence.
- **Nothing in the pipeline reads flags at runtime.** The loop is:

  ```
  flag → data → human review → eval set → measured prompt or code change
  ```

  and explicitly not:

  ```
  flag → automatic prompt mutation
  ```

## Alternatives considered

**Fine-tuning or a LoRA on flagged examples.** Rejected on four independent grounds, any one of which is sufficient:
a single user produces tens of flags a year where thousands are needed; training is impractical on a 4 GB laptop GPU;
shipping a tuned model contradicts ADR-0001's "the user brings their own Ollama model"; and one person's flags would
overfit the model to one person's taste.

**RLHF or preference optimisation.** Rejected for the same reasons, with more machinery.

**Automatic few-shot injection of flagged examples.** Rejected as a _default_, though few-shot examples remain a
legitimate manual technique. Automatically appending examples has three problems: the context budget is bounded by
VRAM, so growing the prompt can push the model off the GPU; a mistaken flag (the reader was simply wrong) would
silently degrade generation; and with no measurement, the change would feel like an improvement whether or not it was
one. Three times during this project a confident prediction was overturned by measurement — an automatic loop would
have hidden all three.

**A single thumbs-down with no reason.** Rejected — cheaper for the user, useless to act on. The extra tap buys the
difference between "something is wrong" and "here is the rule to add".

**Suppress silently without recording anything.** Rejected — it fixes today's annoyance and discards the only quality
signal a local-first, single-user app can ever get.

## Consequences

**Easier.**

- A flag becomes a permanent regression case: the same defect cannot quietly return.
- Flags on `ambiguous` and `implausible-distractors` point at **code**, where a fix is deterministic and testable —
  likely the most common flags, and the ones an automatic prompt loop would have handled worst.
- Prompt versions become comparable on real usage, which is what M-7 needs and could not otherwise get.
- The user sees an immediate effect, so flagging feels worth doing.

**Harder.**

- **Improvement is not automatic.** Acting on flags requires a person to look at them. For a single-user app that is
  acceptable — the user and the maintainer are the same person — but it is a real limitation, and it is the cost
  being accepted here.
- One more tap before a flag is recorded, and a menu to read.
- Reason codes are a fixed vocabulary that will turn out to be incomplete. Adding one is a migration.
- Nothing yet reads `feedbackCounts()` — the plumbing exists ahead of the harness that consumes it, which is
  deliberate but is currently unused code.

**At scale.** Flags are bounded by how many questions one person reads. No growth concern.

<!-- ADRs are per-item and immutable except Status. To change a decision, add a new ADR that supersedes this one. -->

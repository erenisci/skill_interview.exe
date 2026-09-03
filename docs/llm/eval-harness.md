---
title: Eval Harness
discipline: llm
status: active
updated: 2026-09-02
---

# Eval Harness

> **Purpose.** How generation quality is measured, so it is a number rather than an impression.
> **Related.** [prompts.md](prompts.md) · [../quality/testing-strategy.md](../quality/testing-strategy.md)

The unit tests prove the code works. They say nothing about whether the card is true or the distractors are any
good — and that is what decides whether this product is worth using. The eval harness is the second test suite.

Run: `npm run eval`. Lives in `evals/`. Gates every prompt change and every release
([../project/release-plan.md](../project/release-plan.md)).

## Eval Sets

Fixed inputs, so runs are comparable across prompt and model changes.

| Set                             | Contents                                                                                                                                                                                                                              | Targets                                                                |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| `grounding.jsonl`               | Skills with a fixed, frozen set of source documents                                                                                                                                                                                   | Does the card only state what the sources support?                     |
| `distractor-plausibility.jsonl` | Related skill pairs with known real differences (nginx/Traefik, Java/Python, WSL/VM)                                                                                                                                                  | Are the wrong options plausible and actually wrong?                    |
| `schema-conformance.jsonl`      | All five generation tasks                                                                                                                                                                                                             | Does output parse against its schema on the first attempt?             |
| `language.jsonl`                | The same skills requested in Turkish and English                                                                                                                                                                                      | Correct language; technical terms untranslated                         |
| `refusal.jsonl`                 | Skills with deliberately empty or useless retrieval                                                                                                                                                                                   | Does the job fail rather than inventing a card?                        |
| `injection.jsonl`               | Source documents containing embedded instructions                                                                                                                                                                                     | Are they ignored? ([guardrails.md](guardrails.md))                     |
| `disambiguation.jsonl`          | Two kinds. **Wrong subject:** Zustand/Pompeii, Tauri/the ancient people, Vitest/Playwright, Redis/JavaGuide. **Tooling around the subject:** PostgreSQL against `ANXS/postgresql`, an Ansible role ([TD-10](../project/tech-debt.md)) | Is the right candidate chosen, and is "none" chosen when it should be? |

Sources in the eval sets are **frozen copies**, not live fetches. A live web fetch would make results
non-reproducible and confuse a search regression with a prompt regression.

## Metrics

| Metric                      | Definition                                                        | Why it matters                                                                                                                                      |
| --------------------------- | ----------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Groundedness**            | Share of card claims supported by the supplied sources            | The product's core promise                                                                                                                          |
| **Distractor plausibility** | Share of distractors that are plausible _and_ unambiguously wrong | The hardest generation problem                                                                                                                      |
| **Ambiguity rate**          | Share of questions with a second defensible correct answer        | The most damaging single failure                                                                                                                    |
| **Schema pass rate**        | Share of outputs parsing on the first attempt                     | Directly predicts retry cost and user-visible failures                                                                                              |
| **Language accuracy**       | Correct language, terms untranslated                              | The Turkish risk, measured                                                                                                                          |
| **Refusal rate**            | Share of empty-retrieval cases that correctly fail                | Proves the grounding rule holds under pressure                                                                                                      |
| **Injection resistance**    | Share of embedded instructions ignored                            | Security, not quality                                                                                                                               |
| **Resolution precision**    | Share of resolved sources that are actually the named technology  | A wrong source produces a fluent, cited, wrong card — the worst failure the product has ([ADR-0003](../architecture/adr/0003-source-resolution.md)) |
| **Resolution refusal**      | Share of no-correct-candidate cases answered "none"               | A model that never refuses will always find _something_, which is how the failure happens                                                           |

**Groundedness, plausibility, and ambiguity are judged by a human reviewer**, not by a second model call. An
LLM-as-judge inherits the failure modes of the model under test — it is most confident exactly where the model is
most wrong. The sets are kept small enough for manual scoring to stay affordable.

Schema pass rate, language accuracy, refusal rate, and injection resistance are checked deterministically in code.

## Regression Checks

**A prompt change requires an eval run before merge.** No eval run means the change to product output is untested.

Rules:

- No metric may drop below the recorded baseline without a written reason.
- Ambiguity rate is a hard gate: an increase blocks the merge outright.
- A model change is a behaviour change and requires a full run before the recommended model is updated.
- Distractor assembly changes require the plausibility set, comparing sibling-sourced distractors against
  model-generated ones — that comparison is the whole justification for the sibling-distractor design
  ([../architecture/system-design.md](../architecture/system-design.md)).

## Results

Each release records its scores here, so movement over time is visible.

| Date | Version | Model | Prompt versions | Grounded | Plausible | Ambiguity | Schema | Language | Notes                       |
| ---- | ------- | ----- | --------------- | -------- | --------- | --------- | ------ | -------- | --------------------------- |
| —    | —       | —     | —               | TBD      | TBD       | TBD       | TBD    | TBD      | No runs yet; harness is M-7 |

**Baselines are TBD until the first run.** They will be set from that run rather than guessed, then treated as the
floor.

### First signal, ahead of the harness

`evals/probes/resolve-probe.mjs` ran the real `resolve-source` prompt against `qwen3:4b` on five collisions taken
from the precision probe. **5/5 correct**, including all three cases whose right answer is "none": the ancient Tauri
people, a Java interview guide offered for "Redis", and the TRPC ion channels.

That is the riskiest assumption in [ADR-0003](../architecture/adr/0003-source-resolution.md) — that a small model
will refuse rather than pick the least-wrong option — and it holds on this sample. Five hand-picked cases are not a
baseline; they are a reason to keep going.

One quality signal came with it: the _decisions_ were right while one _explanation_ contradicted itself mid-sentence
("The technology is Taur… but the framework is named 'Tauri'"). Only the decision is used, so this costs nothing
today. It joins the stray duplicated token seen during M-1 as evidence about 4B prose quality, which is what
[TD-07](../project/tech-debt.md) is waiting on.

## What M-7 has to answer

Three questions, not one. Each needs a different sweep of the same sets:

| Question                                             | Sweep                              | Why it matters                                                                                                                                           |
| ---------------------------------------------------- | ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Does `qwen3:4b` clear the quality bar?**           | The recommended model alone        | It is the only model installed, and both dev and production run it. Failing here escalates to 8B ([TD-07](../project/tech-debt.md))                      |
| **How much does output vary across model families?** | Two families at the same size      | Deferred: only one model is installed ([TD-09](../project/tech-debt.md)). Decides allowlist versus per-model variants ([TD-04](../project/tech-debt.md)) |
| **Does constrained decoding cost prose quality?**    | Same model, `format` on versus off | [ADR-0002](../architecture/adr/0002-constrained-decoding.md) accepted this risk without measuring it                                                     |

The third is new and easy to overlook: constraining the sampler to a grammar guarantees the output _parses_, and
says nothing about whether it reads well. For a product whose value is the quality of the prose, that is worth a
column of its own. Schema pass rate should sit near ceiling once ADR-0002 is in place — if it does not, the
constraint is not doing what it claims.

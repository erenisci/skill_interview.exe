---
title: Eval Harness
discipline: llm
status: active
updated: 2026-09-04
---

# Eval Harness

> **Purpose.** How generation quality is measured, so it is a number rather than an impression.
> **Related.** [prompts.md](prompts.md) · [../quality/testing-strategy.md](../quality/testing-strategy.md)

The unit tests prove the code works. They say nothing about whether the card is true or the distractors are any
good — and that is what decides whether this product is worth using. The eval harness is the second test suite.

Run: `npm run eval`. Lives in `evals/`. Gates every prompt change and every release
([../project/release-plan.md](../project/release-plan.md)).

## How it is built

**It imports the shipped pipeline rather than re-implementing it.** `evals/run.ts` calls the real `resolveSource`,
`synthesizePrimer` and `generatePairClaims` through the real `OllamaLlmAdapter`. This is not a detail: the one-off
probes in `evals/probes/` hand-write their own Ollama call, and one of them scored resolution at 5/5 while the
shipped code was scoring 1/4 — the probe was measuring a copy that had drifted. The first thing the harness did was
disagree with it, and the disagreement was a real bug ([ADR-0002](../architecture/adr/0002-constrained-decoding.md),
correction).

**Schema conformance is measured across every call the run makes**, rather than from a set of its own as first
planned. Sampling real usage is strictly better than a synthetic set: it measures the prompts that actually run, in
the proportions they actually run in.

**Sources are frozen copies in `evals/sources/`**, with their origin and licence recorded there. Refreshing one
invalidates comparison with every earlier run, so a refresh starts a new baseline rather than continuing the old one.

The deterministic scorers are ordinary pure functions and are covered by the ordinary test suite — a scorer that
quietly miscounts would corrupt every quality number this project records.

## Eval Sets

Fixed inputs, so runs are comparable across prompt and model changes.

| Set                             | Contents                                                                                                                                                                                                                              | Targets                                                                |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| `grounding.jsonl`               | Skills with a fixed, frozen set of source documents                                                                                                                                                                                   | Does the card only state what the sources support?                     |
| `distractor-plausibility.jsonl` | Related skill pairs with known real differences (nginx/Traefik, Java/Python, WSL/VM)                                                                                                                                                  | Are the wrong options plausible and actually wrong?                    |
| `schema-conformance.jsonl`      | All five generation tasks                                                                                                                                                                                                             | Does output parse against its schema on the first attempt?             |
| `language.jsonl`                | Skills whose cards must read as English prose                                                                                                                                                                                         | Prose rather than a fragment; technical terms untranslated             |
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
| **Language accuracy**       | Reads as prose, terms untranslated                                | That a card is writing rather than a scraped fragment                                                                                               |
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

### Baseline — 2026-09-04, `qwen3:4b`

The first real run. Deterministic metrics only; the judged ones are awaiting review
(`evals/results/2026-09-04-qwen3-4b.md`).

| Metric                | Score | Passed | Reading                                                                      |
| --------------------- | ----- | ------ | ---------------------------------------------------------------------------- |
| Resolution precision  | 100%  | 4/4    | After the field-order fix. Was 25% before it                                 |
| Resolution refusal    | 100%  | 3/3    | Includes the `ANXS/postgresql` case TD-10 was open on                        |
| Schema pass rate      | 100%  | 16/16  | ADR-0002 doing what it claims                                                |
| Injection resistance  | 100%  | 2/2    | Both payloads ignored, one of them an HTML comment framed as user-authorised |
| Terms untranslated    | 100%  | 3/3    | Technical terms survive even when the prose does not                         |
| **Refusal rate**      | 50%   | 1/2    | A sign-in page produced a card ([TD-17](../project/tech-debt.md))            |
| **Language accuracy** | 33%   | 1/3    | Turkish asked for, English delivered ([TD-18](../project/tech-debt.md))      |

**These are the baseline and the floor.** No metric drops below its row here without a written reason.

### After the fixes — 2026-09-04, `qwen3:4b`, prompts `primer-card.v2`

Both failing metrics were acted on the same day, and the set that found them measured the fix:

| Metric               | Baseline | After | What changed                                                             |
| -------------------- | -------- | ----- | ------------------------------------------------------------------------ |
| Refusal rate         | 50%      | 100%  | Grounding checked before the model call, not length checked after it     |
| Language accuracy    | 33%      | 100%  | `primer-card.v2` states the language last; a guard rejects it if ignored |
| Terms untranslated   | 100%     | 100%  | Unchanged                                                                |
| Resolution precision | 100%     | 100%  | Unchanged                                                                |
| Resolution refusal   | 100%     | 100%  | Unchanged                                                                |
| Injection resistance | 100%     | 100%  | Unchanged                                                                |
| Schema pass rate     | 100%     | 100%  | Unchanged                                                                |

**One model, deliberately, and the scores are a floor rather than an average.** `qwen3:4b` is close to the smallest
model this product can be built on: it is the one that fits a 4 GB laptop GPU, so anyone running something larger is
running something better. A second 4B family would answer "does another small model behave differently", which is
interesting and does not decide anything here; what decides quality is the judged metrics on the model users are
told to install ([TD-09](../project/tech-debt.md)).

Seven of seven. That is a small set on one model and should be read as "nothing known is broken", not as proof of
quality — the metrics that would say something about quality are the judged ones, and those are still unscored.

Two scoring bugs in the harness were fixed along the way, both found by watching a number move for the wrong reason.
Schema conformance counted a card rejected for **wrong language** as a parse failure, which would have blamed
ADR-0002 for a guard doing its job; it now counts only genuine parse failures. And a failed card was being scored for
term retention it had no prose to demonstrate, punishing one failure twice.

Two of them are already failing, and that is the harness working rather than the harness being wrong. Both failures
were suspected in the docs long before this run — the language risk since M-1, grounding under useless retrieval since
ADR-0003 — and neither was a number until now.

The run also found a bug in **itself** before it found one in the model: the disambiguation fixtures conflated a
candidate's `identity` (what the name gate matches) with its `title`, so the gate rejected correct candidates and the
harness scored that as a model failure. A fixture bug that inflates a failure is as damaging as one that hides it.

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

| Question                                             | Sweep                              | Why it matters                                                                                                                      |
| ---------------------------------------------------- | ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| **Does `qwen3:4b` clear the quality bar?**           | The recommended model alone        | It is the only model installed, and both dev and production run it. Failing here escalates to 8B ([TD-07](../project/tech-debt.md)) |
| **How much does output vary across model families?** | Two families at the same size      | **Not planned.** One model is the tested configuration on purpose — see below ([TD-09](../project/tech-debt.md))                    |
| **Does constrained decoding cost prose quality?**    | Same model, `format` on versus off | [ADR-0002](../architecture/adr/0002-constrained-decoding.md) accepted this risk without measuring it                                |

The third is new and easy to overlook: constraining the sampler to a grammar guarantees the output _parses_, and
says nothing about whether it reads well. For a product whose value is the quality of the prose, that is worth a
column of its own. Schema pass rate should sit near ceiling once ADR-0002 is in place — if it does not, the
constraint is not doing what it claims.

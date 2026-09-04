---
title: 'ADR 0002: Constrained decoding for structured output'
discipline: code
status: Accepted
date: 2026-09-02
---

# ADR 0002: Constrained decoding for structured output

## Status

Accepted — 2026-09-02. **The decision holds; one consequence it did not anticipate is recorded below.**

## Correction — 2026-09-04

Constraining decoding to a schema also constrains **the order the model may think in**, and that turned out to
matter far more than this ADR expected.

Grammar-constrained decoding emits object fields in schema order. Combined with `think: false` — which removes the
model's scratchpad entirely ([../../llm/architecture.md](../../llm/architecture.md)) — whatever field comes first
must be produced before the model has written a word of reasoning.

`resolve-source` had the shape `{ index, reason }`. So the model committed to a candidate index _first_, and then
wrote a justification for a choice it had already made. The results were self-contradicting in a way that reads as
absurd until the cause is clear:

> `index: 0`, `reason: "The candidate describes the Tauri as an ancient people, not the technology Tauri."`

The reasoning was right every time. The answer was wrong every time, and it was wrong **in the specific direction
the product cannot tolerate**: the stage never answered "none", which is the refusal that
[ADR-0003](0003-source-resolution.md) is built on and the single most important safety property in the pipeline.

Measured with `npm run eval` on the same four cases, changing nothing but the field order:

| Schema order        | Correct | Refusals correct |
| ------------------- | ------- | ---------------- |
| `{ index, reason }` | 1 / 4   | 0 / 2            |
| `{ reason, index }` | 3 / 4   | 2 / 2            |

On the full disambiguation set the reordered schema scores **7/7**, including the `ANXS/postgresql` Ansible-role
case that [TD-10](../../project/tech-debt.md) had been open on since M-3.

**The rule this establishes: in any constrained schema, a justification field comes before the decision it
justifies.** It costs nothing — the tokens are generated either way — and it is the difference between a model that
reasons and one that rationalises.

Two things this does not change. Schema conformance is still a runtime guarantee: the eval measured 100% first-attempt
parse across every call. And the prompt still does not restate the shape — the fix was in the schema, not in asking
the model more loudly.

Worth noting how this was found. It was invisible for two milestones because `evals/probes/resolve-probe.mjs`
re-implements the Ollama call by hand and had scored 5/5. The eval harness imports the shipped `resolveSource`
instead, and immediately disagreed with the probe — which is exactly why it imports rather than re-implements
([../../llm/eval-harness.md](../../llm/eval-harness.md)).

## Context

Every generation task in this product returns JSON against a schema: a primer card, a classification, a comparison,
a question with four options and rationales. Prose where JSON was expected is a parse failure, not a partial success
([../../llm/guardrails.md](../../llm/guardrails.md)).

There were two ways to get that JSON, and the choice matters more here than it usually would:

1. **Ask the model in the prompt.** Conformance then depends on how well a particular model follows formatting
   instructions — which is exactly the variance [TD-04](../../project/tech-debt.md) is about. Users choose their own
   model from whatever they pulled into Ollama, so a prompt tuned against one model can produce malformed output on
   another, and to the user that looks like a product bug.
2. **Constrain decoding at the runtime.** Ollama accepts a JSON Schema in the request's `format` field and restricts
   token sampling to outputs that satisfy it.

The second was not obvious at design time; it surfaced while implementing the adapter in M-1.

A third question sits underneath: if decoding is constrained, is validating the output afterwards still worth doing?

## Decision

**Send the JSON Schema with every generation request, and still parse the result.**

- `src/main/llm/adapter.ts` defines `StructuredSchema<T>` carrying both a `jsonSchema` (handed to the runtime) and a
  `parse` (narrowing the result). The two travel together so a caller cannot use one without the other.
- `src/main/llm/schema.ts` derives both from a single zod type, so they cannot drift apart.
- `OllamaLlmAdapter` passes `jsonSchema` as `format` on every `/api/chat` call.
- The parse runs regardless. **Model output is untrusted input even when the model is local** — a local model reading
  a poisoned web page is precisely the injection path, and a grammar constraint says nothing about whether the
  _content_ is sane.

## Consequences

**Easier.**

- Schema conformance becomes a **runtime guarantee** instead of a per-model prompt-following skill. This removes
  roughly half of TD-04's risk: what remains model-dependent is content quality — distractor sharpness and Turkish
  fluency — not whether the response parses.
- The `schema pass rate` metric in [../../llm/eval-harness.md](../../llm/eval-harness.md) should approach ceiling,
  which makes the remaining eval signal about quality rather than plumbing.
- Retry cost drops: malformed-JSON retries were expected to be a routine failure mode and now should be rare.
- Prompts get simpler — they no longer need to beg for JSON, so they carry less model-specific formatting ritual.

**Harder.**

- **The adapter interface now assumes a runtime that supports grammar-constrained decoding.** Ollama and llama.cpp do.
  A cloud provider without a JSON-schema mode would need a prompt-only fallback path, so the "swap in a cloud model"
  option from ADR-0001 is slightly narrower than it was.
- **Constrained decoding can cost content quality.** Forcing the sampler through a grammar sometimes produces stiffer
  or shorter text than free generation. This has not been measured yet, and it is a real risk for a product whose
  value is the quality of the prose. Added to the eval scope.
- Every generation schema must be expressible as JSON Schema, which rules out validation that only zod can express
  (cross-field refinements, for instance). Those checks have to live in the deterministic validator instead — which
  is where the question rules already live, so the cost is small.
- Two representations of one schema exist at runtime. They are derived from a single zod type specifically so they
  cannot diverge; generating them separately would be a defect.

**At scale.** No effect on the single-user library. The constraint is per-request and adds no state.

<!-- ADRs are per-item and immutable except Status. To change a decision, add a new ADR that supersedes this one. -->

---
title: 'ADR 0002: Constrained decoding for structured output'
discipline: code
status: Accepted
date: 2026-09-02
---

# ADR 0002: Constrained decoding for structured output

## Status

Accepted — 2026-09-02

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

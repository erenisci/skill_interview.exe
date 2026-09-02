---
title: AI Review Checklist
discipline: ai
status: active
updated: 2026-09-02
---

# AI Review Checklist

> **Purpose.** What to verify in AI-generated code, beyond the ordinary self-review.
> **Related.** [../engineering/self-review-checklist.md](../engineering/self-review-checklist.md) · [ai-coding-rules.md](ai-coding-rules.md)

Walk [../engineering/self-review-checklist.md](../engineering/self-review-checklist.md) first. This file covers the
failures specific to generated code — the ones that come from fluency rather than carelessness.

The governing risk: **AI-written code looks right.** It is well-formatted, plausibly named, and confidently wrong in
ways hand-written code usually is not.

## Invention

- [ ] Every external API call matches the **real** API. Ollama endpoints, Wikipedia parameters, and search response
      shapes are checked against documentation, not assumed.
- [ ] No invented config key, setting name, or database column.
- [ ] Library methods actually exist in the installed version.
- [ ] No number presented as measured that was never measured — token budgets, memory figures, timings, eval baselines.
- [ ] Documentation edits state `TBD` where the value is unknown, rather than filling a plausible one in.

## Quiet weakening

The most damaging category, because the code still works.

- [ ] No validation rule was loosened to make something pass. Compare against
      [../llm/guardrails.md](../llm/guardrails.md).
- [ ] Grounding is intact: no new path lets generation proceed when retrieval failed.
- [ ] No `catch` swallows an error, and no failure was downgraded to a default value.
- [ ] Retry limits, length bands, and thresholds are unchanged unless the task was to change them.
- [ ] Nothing was made "more robust" by making it silently tolerant.

## Boundaries

- [ ] The renderer gained no database, network, or Node access.
- [ ] Pipeline code imports adapter interfaces, not implementations.
- [ ] New SQL is in a repository.
- [ ] The IPC surface did not widen without a stated reason.
- [ ] The read path still touches only SQLite — no model call, no HTTP request.

## Over-engineering

- [ ] No abstraction layer, factory, or interface introduced for a single implementation that was not already
      required by the adapter design.
- [ ] No caching, pooling, or queueing added that the docs did not ask for.
- [ ] No new dependency where a few lines would do.
- [ ] The change is the size of the task. Unrelated refactoring and reformatting have been split out.

## Correctness under failure

- [ ] Killing the process at this point leaves the database consistent and the job retryable.
- [ ] Re-running the job does not duplicate rows.
- [ ] Every invariant in [../architecture/erd.md](../architecture/erd.md) still holds.
- [ ] The failure cases were exercised, not just described in a comment.

## Consistency

- [ ] Glossary vocabulary, not synonyms.
- [ ] Naming follows [../engineering/naming-conventions.md](../engineering/naming-conventions.md).
- [ ] The approach matches how the same problem is already solved elsewhere in the codebase.
- [ ] Comments explain _why_; nothing merely restates the code.

## Docs

- [ ] Doc changes reflect what the code does now, not what was intended.
- [ ] No link to a document that does not exist.
- [ ] A significant decision is an ADR; an accepted compromise is in
      [../project/tech-debt.md](../project/tech-debt.md).

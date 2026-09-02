---
title: Product Requirements Document
discipline: product
status: active
updated: 2026-09-02
---

# Product Requirements Document — skill_interview.exe

> **Purpose.** The single source of _what_ we're building and _why_, for v1.
> **Related.** [requirements-functional.md](requirements-functional.md) · [roadmap-vision.md](roadmap-vision.md)

## Problem

Knowing how to _use_ a technology and being able to _explain_ it are different skills. Developers list
long technology stacks on their CV, having learned most of them years ago or only reached for them when a
problem demanded it. They can say "let's use this here," but cannot say what the thing actually is, or how
it differs from its closest neighbour. The gap surfaces in interviews.

Existing tools do not close it. Anki requires writing the cards by hand — which is the actual work. Chat
assistants are one-shot: no daily rhythm, no memory of what you already reviewed, and not local. Neither
knows the relationships between the specific technologies on _your_ CV.

Why now: consumer-hardware local models (8B class) are finally good enough for this task, and grounding
them in web search keeps hallucination manageable.

## Goals

- Turn a list of claimed skills into daily, source-backed teaching material with no manual authoring.
- Produce multiple-choice questions whose distractors are plausible, drawn from the user's neighbouring skills.
- Make the difference between related technologies explicit, since that is where interviews probe.
- Keep everything on the user's machine: no account, no server, no telemetry.

## Non-Goals

- Non-technical subject matter (exam prep, general knowledge). The engine is general; v1 scope is not.
- Mobile applications, in v1 and after. This is a desktop product.
- Chat. The user does not converse with the model; generation is a background job.
- Multi-user, sync, or cloud accounts.
- Teaching a technology from zero. This is refresher material for things the user has met before.
- macOS and Linux builds.

## Target Users

Developers whose CV lists many technologies, most learned long ago or used only in passing, who struggle in
interviews to describe a technology or distinguish it from a comparable one. Scope is deliberately limited to
technical skills.

## Scope (v1)

| Area             | Included                                                                  |
| ---------------- | ------------------------------------------------------------------------- |
| Skill entry      | Free text, technology/tool/concept level                                  |
| Research         | Web search → source text, stored with URL, publisher, license, fetch date |
| Primer cards     | 1–2 pages per skill, grounded, with visible source links                  |
| Skill graph      | LLM-assigned category + tags; overlapping categories create relations     |
| Comparison cards | Generated for related skill pairs                                         |
| Questions        | A/B/C/D, distractors from sibling skills, schema-validated                |
| Explanations     | Shown after answering, for the chosen option and the correct one          |
| Daily set        | N cards + M questions, counts user-configurable, FSRS-scheduled           |
| Favourites       | Save cards, questions, notes; export to Markdown                          |
| Reminder         | Tray notification at a user-set time                                      |
| Content language | Turkish or English, user setting                                          |
| Storage          | Local SQLite; internet used only for research                             |

Per-feature behaviour is in [feature-specs.md](feature-specs.md).

## Success Metrics

- **The felt outcome:** answering "what's the difference between nginx and Traefik?" in a real interview without hesitating.
- **v1 milestone:** after adding 10 skills, the app produces a usable daily set for 30 consecutive days without
  a factual error the user notices.
- **Quality threshold:** the share of generated questions flagged "bad options" stays low. This is the single number
  that decides whether the product survives.
- No user-count or growth target. This is not a growth project.

## Assumptions

- The user can install Ollama and pull a ~5 GB model.
- A small local model, grounded in retrieved text, is accurate enough for refresher-level technical content.
  Which size clears that bar is **no longer assumed** — see Open Questions.
- Wikipedia plus general web search covers the "what is it / how does it differ" level being targeted.
- Sibling-skill distractors are more plausible than model-invented ones.
- The user reviews on most days; the scheduler assumes roughly daily use.

## Open Questions

- **How small can the model be?** The 8B-class assumption was made on expected quality, before any hardware was
  measured. An 8B Q4 needs ~5 GB and does not fit a 4 GB laptop GPU — a common configuration. If a 4B model clears
  the quality bar it is the better recommendation, because it reaches more machines. M-7 must answer this.
  See [../llm/architecture.md](../llm/architecture.md) and [TD-07](../project/tech-debt.md).
- Recommended-model policy: a supported-model allowlist, or per-model prompt variants? Narrowed by
  [ADR-0002](../architecture/adr/0002-constrained-decoding.md), which makes schema conformance a runtime guarantee —
  what remains model-dependent is content quality. See [../llm/prompts.md](../llm/prompts.md).
- Whether constraining decoding to a JSON Schema costs prose quality. Unmeasured, and now in the eval scope.
- Turkish output quality on small models may force a larger model or an English-only recommendation for Turkish users.
- How many skills before the daily set becomes unmanageable, and does the scheduler need a cap?

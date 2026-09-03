---
title: Prompts
discipline: llm
status: active
updated: 2026-09-02
---

# Prompts

> **Purpose.** The prompt inventory, the rules every prompt follows, and how prompt changes are managed.
> **Related.** [architecture.md](architecture.md) · [eval-harness.md](eval-harness.md) · [guardrails.md](guardrails.md)

Prompts live in `src/main/llm/prompts/`, one file per task, versioned in the filename (`primer-card.v3.md`).
They are **product code**: a prompt edit changes user-visible output without changing a code path, so it gets its own
commit, its own eval run, and at least a minor version bump ([../project/release-plan.md](../project/release-plan.md)).

## Rules every prompt follows

1. **Ground or fail.** State that the answer must come only from the supplied material, and that missing information
   must be reported rather than filled in. No prompt may invite the model to use its own knowledge.
2. **Delimit untrusted input.** Retrieved web text goes inside explicit markers and is labelled as reference data.
   Instructions found inside it are to be ignored — see [guardrails.md](guardrails.md).
3. **Return JSON against a schema — enforced by the runtime, not asked for in the prose.** The schema is sent as
   `format` on every request, so decoding is constrained to valid output ([ADR-0002](../architecture/adr/0002-constrained-decoding.md)).
   Prompts therefore describe _what the fields mean_, and do not beg for well-formed JSON or restate the shape;
   that ritual was model-specific and is now unnecessary. The output is still parsed afterwards.
4. **State the content language explicitly** as a parameter, with the instruction to keep technical terms in their
   original form rather than translating them.
5. **No self-assessment.** Never ask the model whether its own output is good; the eval harness and deterministic
   validators do that ([eval-harness.md](eval-harness.md)).
6. **Bounded length.** Every text output has a stated length band, checked after generation.

## System Prompts

A shared system preamble establishes the role for every task: a technical writer producing refresher material for a
developer who has met the technology before, working strictly from supplied sources, reporting gaps instead of
filling them, and answering in the requested language with technical terms untranslated.

Task prompts add only what is specific to their task. The preamble is never duplicated across files.

## Templates

| Prompt               | Task                     | Input                                          | Output                                        | Notes                                                                                                                                     |
| -------------------- | ------------------------ | ---------------------------------------------- | --------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `resolve-source`     | Pick the right candidate | Skill name, candidate titles + lead paragraphs | Chosen candidate id, or `none`, with a reason | Runs before anything is written. "None" must be as easy to answer as a pick — a forced choice is how Pompeii becomes a source for Zustand |
| `primer-card`        | Synthesize a primer      | Extracted source text, skill name, language    | Title, body, source references                | Must note disagreement between sources rather than silently picking one                                                                   |
| `classify-skill`     | Assign category and tags | Card and sources                               | Category, tags, confidence                    | Low confidence is stored and surfaced, not hidden                                                                                         |
| `comparison-card`    | Explain a difference     | Two skills' sources                            | Title, body naming concrete differences       | Generic contrasts ("A is simpler") are a failure                                                                                          |
| `question-claims`    | Extract usable claims    | A skill's primer card, language                | 4–8 one-sentence claims                       | Must never name its own technology — a claim that does hands over the answer. Generic claims ("is open source") make worthless options    |
| `discriminate-claim` | Gate a borrowed claim    | Target skill's material, one neighbour's claim | Whether it could be true of the target        | Answers conservatively: unclear means reject. Two correct options is the worst defect a question can have                                 |
| `question-stem`      | Word the question        | The assembled correct and wrong options        | Stem and explanation                          | Told explicitly it is not choosing the answer or writing options. The explanation names what each wrong option actually describes         |

The three replace the planned `generate-question` and `explain-answer` pair. Splitting them is what makes rule 3
enforceable: the model never sees a choice to make, because the options are already fixed by the time it is asked to
write anything ([ADR-0004](../architecture/adr/0004-claim-based-questions.md)).

## Versioning

- Filenames carry the version: `generate-question.v2.md`. Old versions stay in the repository.
- Every generated row stores the `prompt_version` that produced it, so output can be attributed after the fact.
- Changing a prompt requires an eval run before merge, and the score is recorded in [eval-harness.md](eval-harness.md).
- A prompt version is never edited in place after release — a change means a new version file.

## The model-dependence problem

Prompts are written and tuned against one model, but users choose their own from whatever they pulled into Ollama.

**Half of this problem is now closed.** [ADR-0002](../architecture/adr/0002-constrained-decoding.md) sends a JSON
Schema with every request, so whether the response parses no longer depends on how well a given model follows
formatting instructions. What is left is the half that was always harder to fix: **content quality** — distractor
sharpness, grounding discipline, and Turkish fluency all still vary by model, and to the user that variance looks
like a product bug.

That remainder is unresolved. Two candidate answers:

| Option                        | Cost                                                            | Benefit                             |
| ----------------------------- | --------------------------------------------------------------- | ----------------------------------- |
| **Supported-model allowlist** | Restricts user choice; needs maintenance as models are released | One prompt set to maintain and eval |
| **Per-model prompt variants** | N prompt sets, N eval runs, growing maintenance                 | Users keep their model              |

The decision needs eval data across at least two models (M-7), not a guess. Tracked as
[TD-04](../project/tech-debt.md) and an open question in [../product/prd.md](../product/prd.md). Until it is settled,
prompts are written as plainly as possible and avoid model-specific formatting tricks, which is the choice that
degrades most gracefully either way.

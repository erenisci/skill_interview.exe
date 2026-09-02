---
title: Guardrails
discipline: llm
status: active
updated: 2026-09-02
---

# Guardrails

> **Purpose.** What is checked on the way into the model and on the way out, and what is never trusted.
> **Related.** [prompts.md](prompts.md) · [architecture.md](architecture.md) · [../operations/security.md](../operations/security.md)

Guardrails here are **deterministic code**, not a second model call. A model asked to check another model's output
inherits its failure modes and is most confident exactly where it is most wrong.

## Input Validation

**Retrieved web content is untrusted input.** It is the output of a search engine pointed at the open internet, and it
goes into a prompt. Treat it the way you would treat a form field.

| Rule                         | Detail                                                                                  |
| ---------------------------- | --------------------------------------------------------------------------------------- |
| Delimit                      | Source text is wrapped in explicit markers and labelled as reference data               |
| Never concatenate            | It is never joined into the instruction section of a prompt                             |
| Ignore embedded instructions | Prompts state that instructions inside the source region are data, not commands         |
| Truncate                     | Hard token budget per job; oversized documents are cut, not summarized by a second call |
| Extract                      | HTML → text before the model sees it; scripts, markup, and navigation stripped          |
| Discard                      | Login walls, JS-only shells, and empty extractions are dropped at the extraction stage  |

The `injection.jsonl` eval set exists specifically to prove this holds: source documents containing embedded
instructions must be ignored ([eval-harness.md](eval-harness.md)).

**User input** — skill names — is normalized to a slug and length-bounded before use. It is a search query and a
prompt parameter, so it is escaped for both.

## Output Validation

Every model output is parsed against a schema before anything reaches the database. A prose response where JSON was
expected is a parse failure and a retry, never a partial success.

### All generated text

- Parses as JSON against the task's schema, or the job retries and then fails.
- Falls within the task's length band; one reformat retry, then fail.
- Is in the requested content language.
- Is stored with `model` and `prompt_version`.

### Cards

- At least one source row exists, or the card is rejected. **A card without provenance is a bug**
  ([../architecture/erd.md](../architecture/erd.md)).
- Zero usable sources fails the job. There is no path where the model writes from memory — this is the single most
  important rule in the product.
- **Every source has passed resolution.** Provenance is not enough on its own: a card grounded in the wrong subject
  carries a real citation to a real page about something else, and looks exactly like a correct card
  ([ADR-0003](../architecture/adr/0003-source-resolution.md)).

### Sources — validated before anything is written

The original design guarded only against _missing_ sources. Measurement showed the more damaging case is a
_confidently wrong_ one: searching "Zustand" returned the article on Pompeii, and "Redis" on GitHub returned an
interview guide. Both would have grounded a fluent, cited, entirely wrong card.

| Gate              | Rejects                                                                                                         |
| ----------------- | --------------------------------------------------------------------------------------------------------------- |
| **Name match**    | A candidate whose title or repository name does not match the skill's slug                                      |
| **Subject check** | A candidate that matches by name but is a different subject — the ancient Tauri people versus the app framework |
| Extraction        | Login walls, JS-only shells, empty text                                                                         |

Nothing surviving both gates fails the job. The bias is deliberate and asymmetric: refusing a correct source costs
an empty state the user can see, while accepting a wrong one costs their trust in every card they have read.

### Questions — the strict set

Rejection is cheap; a bad question shown to the user is not.

| Rule                 | Rejects                                                                        |
| -------------------- | ------------------------------------------------------------------------------ |
| Exactly four options | Three or five                                                                  |
| Exactly one correct  | Zero, or more than one                                                         |
| No meta-options      | "All of the above", "none of the above", "both A and B"                        |
| No duplicates        | Options identical after normalization                                          |
| Length band          | Options outside a bounded ratio of each other — length is the classic giveaway |
| Rationale present    | Any option without one                                                         |
| Minimum distractors  | Fewer than three usable → the question is dropped, never padded                |

Rejections are **recorded, not silently discarded**: the rejection reason feeds the quality metrics that decide
whether the prompt or the model is at fault.

## Safety

The subject matter is technical documentation, so classic content-safety concerns are minimal. The real risks are
different:

| Risk                                      | Handling                                                                                                                                                                       |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Confident falsehood                       | Grounding, mandatory provenance, visible source links so the user can verify                                                                                                   |
| **Grounding to the wrong subject**        | Resolution gates before retrieval ([ADR-0003](../architecture/adr/0003-source-resolution.md)). Provenance alone does not catch this — the citation is real, the subject is not |
| Prompt injection from a source page       | Delimiting, instruction-ignoring prompts, injection eval set                                                                                                                   |
| Rendering untrusted content               | Card text renders as text; markup from a source page never executes                                                                                                            |
| Silent quality drift after a model change | `model` and `prompt_version` on every row; eval run required                                                                                                                   |

## Refusals

The system refuses by **failing the job visibly**, never by producing a lower-quality result:

- No usable sources → job fails with its reason shown; no card is created.
- No candidate survives resolution → job fails; the skill is reported as unresolvable rather than researched badly.
- Sources contradict each other → the card states the disagreement rather than picking silently.
- Output fails schema or structural validation after retries → job fails; nothing is stored.
- Fewer than three usable distractors → the question is dropped.

An empty state with an explanation is always preferred over invented content. This is a product decision, not a
technical limitation.

## PII

The app stores no personal data. It has no account, no server, and no telemetry
([../operations/security.md](../operations/security.md)).

The one sensitive thing it holds is **the user's skill list, which is effectively their CV and their gaps**. It never
leaves the machine except as search queries to the configured provider — which is why the default providers are the
key-less ones and why the outbound path is visible in settings. Skill names are never written to logs.

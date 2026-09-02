---
title: AI Coding Rules
discipline: ai
status: active
updated: 2026-09-02
---

# AI Coding Rules

> **Purpose.** Concrete do's and don'ts for AI-assisted code in this repository.
> **Related.** [ai-context.md](ai-context.md) · [../engineering/coding-standards.md](../engineering/coding-standards.md)

## Do

- **Read the relevant doc before writing.** Touching the pipeline means reading
  [../architecture/system-design.md](../architecture/system-design.md) first, not inferring the design from the code.
- **Follow the existing boundaries.** Renderer → IPC → services → adapters. Never shortcut them because it is fewer lines.
- **Parse at the edge.** Model output, search results, IPC payloads, and JSON columns are narrowed from `unknown` by a
  schema parse. Never `as`.
- **Make failure explicit.** Fallible pipeline stages return result-shaped values; the caller handles both branches.
- **Keep the pure parts pure.** The scheduler, validators, and relation computation take state in and return state out.
  No ambient clock, no database access — they carry correctness and must be testable with fixed inputs.
- **Stamp generated rows** with `model` and `prompt_version` at write time.
- **Write the failure-case test**, not only the happy path.
- **Use the glossary's words.** A card is a card, not a note or an article ([../glossary.md](../glossary.md)).
- **Say when something is unknown.** `TBD` in a doc, a question in the chat. Never a plausible invented number.

## Don't

| Don't                                                | Why it matters here                                                            |
| ---------------------------------------------------- | ------------------------------------------------------------------------------ |
| Add a model call or HTTP request to the read path    | Breaks the memory and latency design outright                                  |
| Let generation proceed when retrieval failed         | The product's core promise; a wrong card is worse than no card                 |
| Invent an Ollama or search-provider API shape        | Fluent, plausible, and wrong. Check the real API                               |
| Loosen a validation rule to make a test pass         | The validators _are_ the quality mechanism                                     |
| Pad a question to four options                       | Better to drop it than ship a giveaway                                         |
| Add a second LLM call to check the first             | Inherits the same failure modes ([../llm/guardrails.md](../llm/guardrails.md)) |
| `catch { /* ignore */ }`                             | Silent failure surfaces as an empty card with no explanation                   |
| Import a concrete adapter outside its folder         | Makes the swappability in ADR-0001 a lie                                       |
| Give the renderer database or network access         | The security model rests on this boundary                                      |
| Render retrieved content as HTML                     | It is untrusted web content                                                    |
| Add a dependency without a reason worth stating      | Main-process packages run with full user privileges                            |
| Introduce DDD, CQRS, an event bus, or a DI container | Solo desktop app. Complexity needs a real requirement                          |
| Reformat or "tidy" files the task did not touch      | Buries the real change in the diff                                             |

## Patterns to follow

**Adding a pipeline stage.** Add it to the stage sequence; make it idempotent so a retried job does not duplicate rows;
give it explicit failure handling; unit-test it with stubbed adapters.

**Adding a provider.** Implement the existing adapter interface in its own file. Nothing outside that folder should
change. If pipeline code needs editing, the abstraction is wrong.

**Changing a prompt.** New version file, never an edit in place. Own commit. Eval run before merge, scores recorded in
[../llm/eval-harness.md](../llm/eval-harness.md). Decide what happens to already-generated content.

**Changing the schema.** New numbered, forward-only migration. Never edit a released one. Test against a populated
copy of a real database.

**Adding a query.** It goes in a repository. If it is on the daily path, it has an index.

## Files AI must not touch unprompted

| Path                                         | Why                                                                                 |
| -------------------------------------------- | ----------------------------------------------------------------------------------- |
| `src/main/db/migrations/*` (released ones)   | Already applied on users' machines                                                  |
| `src/main/llm/prompts/*` (existing versions) | Attributed to generated rows; changes need a new version and an eval run            |
| `evals/*.jsonl`                              | Frozen inputs. Editing them makes scores incomparable and quietly hides regressions |
| `CHANGELOG.md` past versions                 | Append-log; history is never rewritten                                              |
| `LICENSE`                                    | A legal decision, not a code change                                                 |
| `%APPDATA%/skill-interview/skills.db`        | The user's real data                                                                |
| `docs/architecture/adr/*` (accepted ones)    | Immutable except Status; supersede with a new ADR                                   |

## When to stop and ask

- The task implies a product-scope change. Scope belongs to the author; scope creep is this project's named risk.
- Two docs disagree, or a doc disagrees with the code.
- The simple solution requires crossing a boundary this file forbids.
- A number is needed that has not been measured.

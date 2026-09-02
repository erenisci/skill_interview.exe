---
title: Coding Standards
discipline: code
status: active
updated: 2026-09-02
---

# Coding Standards

> **Purpose.** How code in this repository is written, so it stays readable by one person over a long time.
> **Related.** [naming-conventions.md](naming-conventions.md) · [self-review-checklist.md](self-review-checklist.md)

## Language

TypeScript, `strict` on, across main process, preload, and renderer.

- **No `any`.** Model output arrives as `unknown` and is narrowed by a schema parse, never cast.
- **No non-null assertions (`!`)** to silence the compiler. If a value can be absent, handle absence.
- Prefer `type` for data shapes, `interface` for adapter contracts that implementations satisfy.
- Discriminated unions over boolean flags: `{ status: 'ready' } | { status: 'failed'; error: string }` beats
  `isReady` plus a nullable error.
- Return `Result`-shaped values from fallible pipeline stages rather than throwing across stage boundaries.

## Formatting and Lint

- Prettier for formatting; ESLint with the TypeScript plugin for rules. Both run in CI and block the build.
- Formatting is never argued about — whatever Prettier does is correct.
- Lint errors are fixed, not disabled. A `// eslint-disable` needs a comment saying why on the same line.

## Patterns

**Parse at the boundary.** Anything from outside — model output, search results, IPC payloads, database JSON columns
— is parsed into a known type at the edge. Once inside, types are trusted because they were verified once.

**Adapters hide providers.** Pipeline code depends on `LlmAdapter` and `SearchAdapter`, never on a concrete
implementation. Adding a provider must not require touching pipeline code.

**Pure where it matters.** The scheduler, validators, and relation computation take state in and return state out,
with no ambient clock or database access. They carry the product's correctness and must be testable with fixed inputs.

**Repositories own SQL.** Every query lives in `db/repositories/`. Nothing else builds a SQL string.

**Jobs are durable.** Background work is a row, not a promise. A crash mid-work must leave the database consistent
and the job retryable.

**Stamp everything generated.** Any row produced by the model records `model` and `prompt_version` at write time.
Without them a quality regression cannot be attributed to anything.

**Explicit failure over silent fallback.** If retrieval yields no usable sources, the job fails visibly. It never
falls back to letting the model write from memory — that is the product's central failure mode, not a graceful degradation.

## Anti-patterns

| Don't                                                              | Why                                                                                     |
| ------------------------------------------------------------------ | --------------------------------------------------------------------------------------- |
| Reach into the database from the renderer                          | Breaks the boundary the whole security model rests on                                   |
| Import `ollama.ts` outside `llm/`                                  | Makes the adapter a lie                                                                 |
| `try { … } catch { /* ignore */ }`                                 | Silent failure in a pipeline surfaces as an empty card with no explanation              |
| Cast model output with `as`                                        | The one place types are least trustworthy                                               |
| Interpolate retrieved web text into a prompt without delimiting it | Retrieved content is untrusted input — see [../llm/guardrails.md](../llm/guardrails.md) |
| Keep the model loaded "in case"                                    | The memory design depends on releasing it                                               |
| Add a second LLM call to check the first                           | Inherits the same failure modes; use deterministic validation                           |
| Edit a released migration                                          | Databases in the wild have already run it                                               |
| Pad a question to four options                                     | Better to drop the question than ship a giveaway                                        |

## Comments

Comment the _why_, never the _what_. The code says what it does.

Worth a comment: a non-obvious constraint (why the model is released here), a workaround for a provider quirk, a
decision that looks wrong without context — with a link to the ADR where one exists.

Not worth a comment: restating the line below it, commented-out code (delete it; git remembers), or a `TODO` with no
owner or condition. Real follow-ups go in `SCRATCH.md` or [../project/tech-debt.md](../project/tech-debt.md).

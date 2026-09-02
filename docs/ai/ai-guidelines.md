---
title: AI Development Guidelines
discipline: ai
status: active
updated: 2026-09-02
---

# AI Development Guidelines

> **Purpose.** How AI assistance is used to _build_ this project — distinct from the LLM the product ships.
> **Related.** [ai-coding-rules.md](ai-coding-rules.md) · [ai-review-checklist.md](ai-review-checklist.md) · [ai-context.md](ai-context.md)

Two different LLMs are involved in this project and confusing them causes real mistakes:

|                 | Model                         | Purpose                                        | Documented in                     |
| --------------- | ----------------------------- | ---------------------------------------------- | --------------------------------- |
| **Product**     | The user's local Ollama model | Generates cards and questions for the end user | [../llm/](../llm/architecture.md) |
| **Development** | Claude, via Claude Code       | Helps write the application                    | This folder                       |

This folder is about the second.

## How AI is used here

This is a solo project. AI assistance covers what a second engineer would otherwise do: drafting implementations,
reviewing diffs, working through architecture options, writing tests, and keeping documentation current.

Used for:

- Implementing features against a written spec ([../product/feature-specs.md](../product/feature-specs.md))
- Drafting tests, especially failure cases that are easy to forget
- Reviewing diffs against [../engineering/self-review-checklist.md](../engineering/self-review-checklist.md)
- Working through trade-offs before an ADR is written
- Keeping docs in sync via `/acta:track`

Not used for:

- Deciding product scope. Scope is the author's, and this project's biggest named risk is scope creep
- Choosing the architecture. AI argues the trade-offs; the author decides and records it in an ADR
- Judging generated content quality. That is what the eval harness and a human reviewer are for
  ([../llm/eval-harness.md](../llm/eval-harness.md))

## Boundaries

1. **Docs are the source of truth, not the model's memory.** Before writing in an area, the relevant doc is read.
   A conflict between the code and a doc is resolved explicitly, not silently.
2. **Unknown stays `TBD`.** Fabricating a plausible number — a token budget, a memory figure, an eval baseline — is
   worse than an honest gap, because it later reads as measured fact.
3. **Every significant decision gets an ADR**, written by the author with AI help, not generated unattended.
4. **Nothing is committed unreviewed.** Generated code is read line by line before it lands.
5. **AI does not run destructive commands unprompted** — no force push, no history rewrite, no deleting the local
   database.
6. **Never read or write real secrets.** Env documentation derives from committed templates only
   ([../operations/env-vars.md](../operations/env-vars.md)).

## Review expectations

AI-written code is reviewed **more** carefully than hand-written code, not less. It is fluent, which makes wrong code
look right.

Particular attention to the failure modes this project cares about:

- Silent failure paths — the anti-pattern most likely to be generated, and the one that most damages this product
  ([../operations/error-handling.md](../operations/error-handling.md))
- Boundary violations — renderer reaching for the database, pipeline importing a concrete adapter
- Invented API surface on Ollama or a search provider
- Validation rules quietly loosened to make a test pass
- Grounding weakened — any path that lets the model write without sources

The specific checks are in [ai-review-checklist.md](ai-review-checklist.md).

## Attribution

AI-assisted commits are not specially marked; the author is responsible for everything merged regardless of how it was
drafted. Decisions influenced by an AI-assisted exploration are recorded in [ai-decision-log.md](ai-decision-log.md)
with the reasoning, so the _why_ survives the conversation that produced it.

---
title: AI Context
discipline: ai
status: active
updated: 2026-09-02
---

# AI Context

> **Purpose.** The briefing an AI assistant needs before touching this codebase. Read this first.
> **Related.** [../../CLAUDE.md](../../CLAUDE.md) · [ai-coding-rules.md](ai-coding-rules.md)

## Project summary

**skill_interview.exe** — a local-first Windows desktop app. The user types the technical skills from their CV; a
background pipeline researches each one on the web, and a **local** LLM writes a grounded 1–2 page primer plus
multiple-choice questions. Related skills are linked automatically and get comparison cards. A spaced-repetition
scheduler serves a small daily set. Everything stays on the machine.

Solo author. No deadline. MIT licensed, open source, but `docs/` is not published.

## Key facts

| Fact           | Detail                                                                                                      |
| -------------- | ----------------------------------------------------------------------------------------------------------- |
| **Stack**      | Electron + TypeScript + React; Node main process; `better-sqlite3` with FTS5                                |
| **LLM**        | The **user's own** Ollama model, 8B class. Not an API. Behind `LlmAdapter`                                  |
| **Search**     | GitHub API + official docs + Wikipedia, key-less. Every result passes resolution before it grounds anything |
| **Platform**   | Windows only. Mobile is permanently out of scope                                                            |
| **Scheduling** | FSRS                                                                                                        |
| **Storage**    | One SQLite file in `%APPDATA%/skill-interview/`                                                             |

## The five things that are easy to get wrong

**1. Two different LLMs.** The product's model is the user's local Ollama model. The development assistant is a
different thing entirely. `docs/llm/` is about the product's model.

**2. Generation is split from consumption — this is the whole architecture.** The model runs only in background jobs
and is released when the queue drains. The daily read path touches SQLite and nothing else. Any change that puts a
model call or an HTTP request in the read path breaks a product requirement, not a preference
([../architecture/adr/0001-initial-architecture.md](../architecture/adr/0001-initial-architecture.md)).

**3. Grounding is absolute.** Every card is written from retrieved sources. If retrieval yields nothing usable, the
job **fails visibly**. There is no fallback to the model writing from memory. A confidently wrong card destroys the
only thing this product sells ([../llm/guardrails.md](../llm/guardrails.md)).

**4. Distractor quality is the product's central problem.** Wrong options come from the user's _sibling skills'_ real
properties, assembled by code, not invented by the model. Questions failing validation are dropped, never padded
([../architecture/system-design.md](../architecture/system-design.md)).

**5. Prompts are model-dependent and this is unresolved.** Prompts are tuned against one model, but users pick their
own. Allowlist versus per-model variants is decided by eval data in M-7, not by guessing
([../llm/prompts.md](../llm/prompts.md), [TD-04](../project/tech-debt.md)).

## Boundaries that must hold

```text
renderer ──IPC──▶ main ──▶ adapters ──▶ outside world
                    └──▶ repositories ──▶ SQLite
```

- Renderer: no database, no network, no Node. `contextIsolation` on, `nodeIntegration` off.
- Pipeline imports adapter **interfaces**, never `ollama.ts` or `wikipedia.ts`.
- All SQL lives in `db/repositories/`.
- Every generated row stores `model` and `prompt_version`.

## Current state

Greenfield — documentation is complete, no application code exists yet. Next is M-1: Electron scaffold, SQLite schema,
Ollama adapter. See [../progress.md](../progress.md) and [../project/roadmap.md](../project/roadmap.md).

## Pointers

| Need                        | Read                                                                                                                        |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| What we're building and why | [../product/prd.md](../product/prd.md)                                                                                      |
| How it fits together        | [../architecture/overview.md](../architecture/overview.md)                                                                  |
| Why Electron and not Rust   | [../architecture/adr/0001-initial-architecture.md](../architecture/adr/0001-initial-architecture.md)                        |
| The hard parts              | [../architecture/system-design.md](../architecture/system-design.md)                                                        |
| Schema                      | [../architecture/database-design.md](../architecture/database-design.md) · [../architecture/erd.md](../architecture/erd.md) |
| LLM usage and prompts       | [../llm/architecture.md](../llm/architecture.md) · [../llm/prompts.md](../llm/prompts.md)                                   |
| What is checked and refused | [../llm/guardrails.md](../llm/guardrails.md)                                                                                |
| Where code goes             | [../engineering/project-structure.md](../engineering/project-structure.md)                                                  |
| How to write it             | [../engineering/coding-standards.md](../engineering/coding-standards.md)                                                    |
| Known compromises           | [../project/tech-debt.md](../project/tech-debt.md)                                                                          |
| Vocabulary                  | [../glossary.md](../glossary.md)                                                                                            |

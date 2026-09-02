---
title: Naming Conventions
discipline: code
status: active
updated: 2026-09-02
---

# Naming Conventions

> **Purpose.** One name per concept, everywhere — docs, code, database, UI.
> **Related.** [coding-standards.md](coding-standards.md) · [../glossary.md](../glossary.md)

The domain vocabulary is fixed in [../glossary.md](../glossary.md). Code uses those words and no synonyms: a card is
never a "note" or an "article"; a distractor is never a "wrong answer"; a skill is never a "topic" or a "tech".

## Files

| Kind               | Convention                   | Example                         |
| ------------------ | ---------------------------- | ------------------------------- |
| Folders            | lowercase-kebab              | `src/main/pipeline/`            |
| TypeScript modules | lowercase-kebab              | `distractor-assembly.ts`        |
| React components   | PascalCase, one per file     | `DailySet.tsx`                  |
| Type-only modules  | lowercase-kebab, `.types.ts` | `question.types.ts`             |
| Tests              | sibling, `.test.ts`          | `validator.test.ts`             |
| Migrations         | `NNN-description.sql`        | `003-add-prompt-version.sql`    |
| Prompts            | `purpose.vN.md`              | `primer-card.v3.md`             |
| Eval sets          | `purpose.jsonl`              | `distractor-plausibility.jsonl` |

## Variables and Functions

- `camelCase` for variables and functions; `PascalCase` for types and classes; `SCREAMING_SNAKE` for module-level constants.
- Booleans read as predicates: `isReady`, `hasSources`, `canGenerate`.
- Functions are verb phrases: `assembleDistractors`, `computeRelations`, `extractText`.
- Repository methods say what they return: `findSkillBySlug`, `listDueQuestions`, `insertCardWithSources`.
- Async functions are not suffixed with `Async` — the type says it.
- No abbreviations beyond the glossary's: `question` not `q`, `distractor` not `dist`. `db` and `id` are fine.

## Types

- Adapter interfaces are nouns: `LlmAdapter`, `SearchAdapter`. Implementations name the provider: `OllamaLlmAdapter`.
- Pipeline stage inputs and outputs are named after the stage: `SynthesizeInput`, `SynthesizeOutput`.
- Union members are lowercase string literals matching the database values exactly: `'primer' | 'comparison'`.
- IPC channel names are `domain:action` — `skills:add`, `daily:get`, `questions:flag`.

## Database

- Tables plural snake_case: `skills`, `skill_relations`, `card_sources`.
- Columns snake_case; foreign keys `<singular>_id`: `skill_id`, `question_id`.
- Timestamps end in `_at` and store ISO-8601 text: `created_at`, `due_at`, `fetched_at`.
- Status columns are `status`, holding the same literals the TypeScript union uses.
- No prefixes on table names, no Hungarian notation on columns.

## Branches

`<type>/<short-description>` — `feat/distractor-assembly`, `fix/job-stuck-running`, `docs/adr-0002`,
`chore/electron-bump`. Lowercase, hyphens, no issue numbers unless one exists.

## Commits

Conventional Commits:

```text
<type>(<scope>): <subject>

feat(pipeline): assemble distractors from sibling skills
fix(queue): reset jobs stuck in running after timeout
docs(adr): record the Electron over Tauri decision
chore(deps): bump electron to 33
```

Types: `feat`, `fix`, `docs`, `refactor`, `test`, `chore`, `perf`.
Scopes match top-level areas: `pipeline`, `queue`, `llm`, `search`, `db`, `scheduler`, `ui`, `eval`.

Subject in the imperative, lowercase, no trailing period. A prompt change says so explicitly — it changes output even
when no code path changes.

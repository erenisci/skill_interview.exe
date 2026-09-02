---
title: Project Structure
discipline: code
status: active
updated: 2026-09-02
---

# Project Structure

> **Purpose.** Where code lives and what may depend on what.
> **Related.** [../architecture/overview.md](../architecture/overview.md) · [coding-standards.md](coding-standards.md)

## Layout

`(M-n)` marks a folder the roadmap has not reached yet — the shape is settled, the code is not written.

```text
skill_interview.exe/
├── src/
│   ├── main/                  # Electron main process — all privileged work
│   │   ├── index.ts           # app lifecycle, window creation, CSP, startup
│   │   ├── context.ts         # wires db + repositories + the chosen LlmAdapter
│   │   ├── ipc/               # typed IPC handlers — the only door from the UI
│   │   ├── db/
│   │   │   ├── index.ts       # connection, pragmas
│   │   │   ├── migrate.ts     # forward-only, transactional
│   │   │   ├── migrations/    # ordered .sql files, imported raw
│   │   │   └── repositories/  # one per aggregate; all SQL lives here
│   │   ├── llm/
│   │   │   ├── adapter.ts     # LlmAdapter + StructuredSchema interfaces
│   │   │   ├── schema.ts      # zod → JSON Schema + parse, from one source
│   │   │   ├── ollama.ts      # the only file that knows Ollama exists
│   │   │   ├── stub.ts        # model-free adapter for tests and dev
│   │   │   └── prompts/       # (M-2) prompt templates, versioned
│   │   ├── startup/           # readiness check: runtime, model list, selection
│   │   ├── util/              # slug normalization, structured logger
│   │   ├── search/            # (M-2) SearchAdapter, wikipedia, duckduckgo, extract
│   │   ├── queue/             # (M-2) durable job loop: claim, retry, model release
│   │   ├── pipeline/          # (M-2) retrieve → extract → synthesize → classify → relate → generate → validate
│   │   ├── scheduler/         # (M-5) FSRS state and daily-set assembly
│   │   ├── notify/            # (M-5) tray icon and reminders
│   │   └── export/            # (M-6) favourites → Markdown
│   ├── renderer/              # React UI — no DB, no network, no Node
│   │   ├── App.tsx
│   │   ├── views/             # setup · skills (daily set, favourites, settings later)
│   │   └── styles/
│   ├── preload/               # contextBridge surface, nothing else
│   └── shared/                # types crossing the IPC boundary; no runtime deps
│       ├── domain.ts          # Skill, Card, Question, Job, readiness
│       ├── ipc.ts             # channel names + request/response contract
│       └── result.ts          # Result and AppError
├── evals/                     # (M-7) eval sets and runner
├── docs/
├── resources/                 # (M-8) icons, installer assets
├── electron.vite.config.ts
└── package.json
```

Tests sit beside what they test as `*.test.ts`, not in a separate tree.

## What Goes Where

| Put it in                             | When                                                        |
| ------------------------------------- | ----------------------------------------------------------- |
| `src/main/pipeline/`                  | It transforms content on the way to the database            |
| `src/main/llm/` or `src/main/search/` | It knows a provider's API shape                             |
| `src/main/db/repositories/`           | It is a SQL query                                           |
| `src/main/scheduler/`                 | It decides what the user sees today                         |
| `src/renderer/`                       | It is presentation. If it needs data, it asks over IPC      |
| `src/shared/`                         | Both sides need the type. Types only — no runtime code      |
| `evals/`                              | It measures generation quality rather than code correctness |

## Boundaries

Dependencies point one way. A violation is a review failure, not a style preference:

```text
renderer ──▶ shared ◀── main
                        └──▶ pipeline ──▶ adapters ──▶ outside world
                        └──▶ db
```

- **The renderer never touches the database, the network, or Node APIs.** `contextIsolation` on, `nodeIntegration`
  off, everything through preload's `contextBridge`.
- **Pipeline code never imports `ollama.ts` or `wikipedia.ts`** — only the adapter interfaces. This is what makes
  [ADR-0001](../architecture/adr/0001-initial-architecture.md)'s swappability claim true rather than aspirational.
- **Adapters know nothing about the domain.** `SearchAdapter` returns documents, not skills.
- **Repositories own SQL.** No query strings anywhere else.
- **`shared/` has no runtime dependencies** — importing it must never pull Node or React into the other side.

## Conventions

- Folders lowercase-kebab; TypeScript files lowercase-kebab; React components PascalCase.
- One prompt per file under `llm/prompts/`, with its version in the filename.
- Migrations are numbered and never edited after being released.
- No file grows past a few hundred lines without a reason; split by responsibility, not by size.

Naming rules in detail: [naming-conventions.md](naming-conventions.md).

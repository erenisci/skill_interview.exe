---
title: Onboarding
discipline: knowledge
status: active
updated: 2026-09-02
---

# Onboarding

> **Purpose.** Get from a clean Windows machine to a running dev build.
> **Related.** [project-structure.md](engineering/project-structure.md) · [maintenance.md](maintenance.md)

## Prerequisites

| Requirement | Version                    | Note                                                      |
| ----------- | -------------------------- | --------------------------------------------------------- |
| Windows     | 10/11                      | Only supported platform                                   |
| Node.js     | LTS                        | Runs Electron main process and build tooling              |
| npm         | bundled                    | Package manager                                           |
| Ollama      | current                    | Must be installed and running on `http://localhost:11434` |
| Model       | `qwen3:4b` for development | ~2.5 GB, Q4 quantized — fits a 4 GB GPU entirely          |
| Disk        | ~10 GB free                | Model + node_modules + build output                       |

**One model, and it is the production one.** `qwen3:4b` is what is developed against _and_ what the app recommends,
so no decision is ever made on hardware nobody has. It is ~2.5 GB and fits a 4 GB GPU entirely, which matters: an 8B
Q4 needs ~5 GB, spills onto the CPU, and turns generation from seconds into minutes. Why 4B and what would overturn
it: [llm/architecture.md](llm/architecture.md).

**Verify it is actually on the GPU** after pulling, and after any change to the context budget:

```bash
ollama run qwen3:4b "hi"
ollama ps        # must report 100% GPU
```

The app forces full offload itself (`num_gpu`), so a plain `ollama run` may show a CPU share where the app does not —
that is expected. What matters is what `ollama ps` reports while the app is generating.

**Optional tuning.** Flash attention and a quantized KV cache cut the memory a given context costs, which buys
headroom at larger contexts. They are Ollama _server_ settings, so the app cannot set them:

```bash
setx OLLAMA_FLASH_ATTENTION 1
setx OLLAMA_KV_CACHE_TYPE q8_0   # restart Ollama afterwards
```

The app also runs with **no model at all**: generation is stubbed and everything else — adding skills, storage, the
job queue — works normally. That is deliberate, because generation is split from consumption.

## Setup

```bash
git clone <repo-url>
cd skill_interview.exe
npm install

# LLM runtime — optional for most development work
ollama pull qwen3:4b     # the only model; dev and production are the same
ollama serve             # usually already running as a service
```

`npm install` may report that install scripts need approval (npm 11+). `esbuild` and `better-sqlite3` both need
theirs to build: `npm install-scripts approve esbuild better-sqlite3`.

No `.env` is required to run: search defaults to the GitHub API and Wikipedia, neither of which needs a key.
Optional keys are entered in the app's settings UI, never in a file. See [operations/env-vars.md](operations/env-vars.md).

## First Run

```bash
npm run dev
```

1. The app checks for Ollama; if it is missing or has no model you get the setup screen, which also offers
   "Continue without a model".
2. Add a skill (`nginx`). It is stored with status `pending` — research arrives in M-2.
3. Add a second, related one (`Traefik`), and an unrelated one (`PostgreSQL`), ready for the relation work in M-3.

Later milestones add to this: the job queue panel and the daily set do not exist yet.

## Where Things Live

| Area                                 | Path                        | Exists yet |
| ------------------------------------ | --------------------------- | ---------- |
| Electron main process                | `src/main/`                 | yes        |
| React UI                             | `src/renderer/`             | yes        |
| Preload / `contextBridge` surface    | `src/preload/`              | yes        |
| Types shared across the IPC boundary | `src/shared/`               | yes        |
| IPC handlers                         | `src/main/ipc/`             | yes        |
| Migrations                           | `src/main/db/migrations/`   | yes        |
| Repositories (all SQL lives here)    | `src/main/db/repositories/` | yes        |
| LLM adapters                         | `src/main/llm/`             | yes        |
| Startup readiness check              | `src/main/startup/`         | yes        |
| Job queue loop                       | `src/main/queue/`           | yes        |
| Prompt templates                     | `src/main/llm/prompts/`     | M-2        |
| Search adapters                      | `src/main/search/`          | M-2        |
| Pipeline stages                      | `src/main/pipeline/`        | M-2        |
| Scheduler                            | `src/main/scheduler/`       | M-5        |
| Evaluation sets and runner           | `evals/`                    | M-7        |
| Docs                                 | `docs/`                     | yes        |

## Common Tasks

| Task                      | Command                                      |
| ------------------------- | -------------------------------------------- |
| Dev build with hot reload | `npm run dev`                                |
| Type check                | `npm run typecheck`                          |
| Lint                      | `npm run lint`                               |
| Format                    | `npm run format`                             |
| Unit tests                | `npm test`                                   |
| Production build          | `npm run build`                              |
| Windows installer         | `npm run package`                            |
| LLM eval suite            | `npm run eval` — M-7, not wired yet          |
| Reset local database      | delete `%APPDATA%/skill-interview/skills.db` |

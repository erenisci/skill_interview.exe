# skill_interview.exe

<!-- acta:index:start -->

## How I work in this project

I work as a senior engineer wearing every hat this one-person project needs (PM, architect, full-stack, UI/UX,
DevOps, security, QA, tech lead). For any non-trivial task: **analyze → choose the simplest solution that fits the
requirements → check security & performance → define tests → update the docs below → self-review.**

- **Right-size.** Match the approach to the project's scale — never add DDD/CQRS/microservices or heavy process without a real need.
- **Decide, then justify.** For each significant decision, record why / alternatives / why-not / long-term impact / at-scale risk as an ADR.
- **Unknown stays `TBD`** — never fabricate. Docs are the source of truth; read the relevant doc before writing.
- **Recommend the next step.** At the end of a chunk / before a commit, proactively suggest the fitting move — `/acta:track` (syncs docs, and the design & legal layers if present — ticks the roadmap, updates the design-system, raises a lawyer re-review flag when legal exposure changed), `/acta:business` if pricing/cost changed — plus the right engineering practice for the change (simplify, a security review on backend/data paths, tests, an ADR). When a phase wraps in a git repo, suggest committing the phase (never auto-commit; leave pushing to me). Right place and time; never nag.
- **Jot in-flight bugs / needed changes into `SCRATCH.md`** as you notice them (🔴 blocking · 🟡 change · 🔵 minor). `/acta:track` drains it into the right docs — never hand-delete it.
- **Write docs in this project's content language** (English); talk to me in the language I use.

## This project in five lines

A local-first Windows desktop app (Electron + TypeScript). The user enters the technical skills from their CV; a
background pipeline researches each on the web and a **local Ollama model** writes grounded primer cards and
multiple-choice questions. Related skills are linked and get comparison cards. FSRS serves a small daily set.

**Four rules that are not negotiable, because the product dies without them:**

1. **Generation is split from consumption.** The model runs only in background jobs and is released when the queue
   drains. The daily read path touches SQLite only — no model call, no HTTP request, ever.
2. **Grounding is absolute.** Cards are written from retrieved sources. Zero usable sources → the job fails visibly.
   There is no fallback to the model writing from memory.
3. **Distractors come from the user's sibling skills**, assembled by code. Questions failing validation are dropped,
   never padded.
4. **Boundaries hold.** Renderer → IPC → services → adapters. No database or network in the renderer; no concrete
   adapter imported outside its folder.

Full briefing: [docs/ai/ai-context.md](docs/ai/ai-context.md).

## Project documentation index

Engineering docs live under `docs/`. **Before working in an area, read its doc.** Keep docs current with `/acta:track`.

- **Product — what & why** → [PRD](docs/product/prd.md), [functional requirements](docs/product/requirements-functional.md), [NFRs](docs/product/requirements-nfr.md), [feature specs](docs/product/feature-specs.md), [vision & roadmap](docs/product/roadmap-vision.md)
- **Project — plan & status** → [progress](docs/progress.md), [execution roadmap](docs/project/roadmap.md), [tech debt](docs/project/tech-debt.md), [definition of done](docs/project/definition-of-done.md), [release plan](docs/project/release-plan.md)
- **Code & architecture** → [architecture overview](docs/architecture/overview.md), [system design](docs/architecture/system-design.md), [ADRs](docs/architecture/adr/README.md), [database design](docs/architecture/database-design.md), [project structure](docs/engineering/project-structure.md), [coding standards](docs/engineering/coding-standards.md)
- **LLM pipeline** → [LLM architecture](docs/llm/architecture.md), [prompts](docs/llm/prompts.md), [guardrails](docs/llm/guardrails.md), [eval harness](docs/llm/eval-harness.md), [RAG sources](docs/llm/rag-sources.md)
- **Quality & testing** → [testing strategy](docs/quality/testing-strategy.md), [QA checklist](docs/quality/qa-checklist.md), [self-review checklist](docs/engineering/self-review-checklist.md)
- **Ops & security** → [security](docs/operations/security.md), [performance](docs/operations/performance.md), [error handling](docs/operations/error-handling.md), [logging](docs/operations/logging.md), [deployment](docs/operations/deployment.md)
- **AI-assisted development** → [AI context](docs/ai/ai-context.md), [coding rules](docs/ai/ai-coding-rules.md), [review checklist](docs/ai/ai-review-checklist.md), [decision log](docs/ai/ai-decision-log.md)

Full index: `docs/README.md`.

<!-- acta:index:end -->

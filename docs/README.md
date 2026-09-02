# Documentation

Engineering documentation for **skill_interview.exe** — a local-first Windows desktop app that turns the technical
skills on your CV into daily, source-grounded teaching cards and multiple-choice questions.
This index is **regenerated** by the acta skills — do not hand-curate the list.

**New here?** Start with [AI context](ai/ai-context.md) for the five-minute briefing, then
[the PRD](product/prd.md) for what and why, then [ADR-0001](architecture/adr/0001-initial-architecture.md) for
why the system is shaped this way.

## Product

- [PRD](product/prd.md) — what we're building and why, for v1
- [Functional Requirements](product/requirements-functional.md) — numbered, testable statements of what the system must do
- [Non-Functional Requirements](product/requirements-nfr.md) — performance, reliability, security, and usability bars
- [User Stories](product/user-stories.md) — the product from the user's side, with acceptance criteria
- [Feature Specs](product/feature-specs.md) — per-feature behaviour, states, and edge cases
- [Product Vision & Roadmap](product/roadmap-vision.md) — where this is going, and in what order

## Project

- [Progress](progress.md) — where the project actually stands right now
- [Execution Roadmap](project/roadmap.md) — milestones M-1 to M-9 and their dependencies
- [Release Plan](project/release-plan.md) — versioning and the release checklist
- [Definition of Ready](project/definition-of-ready.md) — the bar before work starts
- [Definition of Done](project/definition-of-done.md) — the bar before work counts as finished
- [Technical Debt Log](project/tech-debt.md) — compromises accepted on purpose, with their cost

## Code & Architecture

- [Architecture Overview](architecture/overview.md) — how the system fits together, and the decision everything follows from
- [System Design](architecture/system-design.md) — the queue, the pipeline, distractor assembly, scheduling
- [ADRs](architecture/adr/README.md) — architecture decision records
- [Database Design](architecture/database-design.md) — schema, indexes, migrations
- [ERD](architecture/erd.md) — entity relationships and invariants
- [Project Structure](engineering/project-structure.md) — where code lives and what may depend on what
- [Coding Standards](engineering/coding-standards.md) — how code here is written
- [Naming Conventions](engineering/naming-conventions.md) — one name per concept, everywhere
- [Git Workflow](engineering/git-workflow.md) — branches, commits, tags, releases
- [Self-Review Checklist](engineering/self-review-checklist.md) — the second reviewer this project does not have

## LLM Pipeline

- [LLM Architecture](llm/architecture.md) — how the model is used and where the quality risk sits
- [Prompts](llm/prompts.md) — the prompt inventory, rules, and the model-dependence problem
- [Guardrails](llm/guardrails.md) — what is validated in, what is validated out, what is never trusted
- [Eval Harness](llm/eval-harness.md) — how generation quality is measured
- [RAG Sources](llm/rag-sources.md) — providers, chunking, retrieval, and licensing obligations
- [Cost & Latency](llm/cost-latency.md) — the memory and time budgets of generation

## Quality

- [Testing Strategy](quality/testing-strategy.md) — two failure modes, two test systems
- [QA Checklist](quality/qa-checklist.md) — the manual pass before a release

## Ops & Security

- [Security](operations/security.md) — Electron hardening, untrusted input, data protection
- [Performance](operations/performance.md) — the memory and latency budgets and how they are defended
- [Error Handling](operations/error-handling.md) — how failures are represented and surfaced
- [Logging](operations/logging.md) — what is logged and, more importantly, what never is
- [Configuration](operations/configuration.md) — every setting, its default, and how values resolve
- [Environment Variables](operations/env-vars.md) — the few that exist, and why config lives elsewhere
- [CI/CD](operations/ci-cd.md) — what runs automatically and what deliberately does not
- [Deployment](operations/deployment.md) — how a build reaches a user's machine

## AI-Assisted Development

- [AI Guidelines](ai/ai-guidelines.md) — how AI is used to build this, and its boundaries
- [AI Context](ai/ai-context.md) — the briefing to read before touching the codebase
- [AI Coding Rules](ai/ai-coding-rules.md) — concrete do's, don'ts, and untouchable files
- [AI Review Checklist](ai/ai-review-checklist.md) — what to verify in generated code
- [AI Decision Log](ai/ai-decision-log.md) — decisions made during AI-assisted work

## Knowledge

- [Onboarding](onboarding.md) — clean machine to running dev build
- [Maintenance](maintenance.md) — the recurring work between features
- [Glossary](glossary.md) — shared vocabulary used by docs, code, and the database

---

- **Start a project:** `/acta:init` → fill `<project>_brief.md` → `/acta:build`
- **After finishing work:** `/acta:track` (updates docs to current state)
- **Existing codebase without docs:** `/acta:adopt`

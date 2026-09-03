---
title: Execution Roadmap
discipline: project
status: active
updated: 2026-09-02
---

# Execution Roadmap

> **Purpose.** The build order — what gets made when, and what each milestone depends on.
> **Related.** [../product/roadmap-vision.md](../product/roadmap-vision.md) · [../progress.md](../progress.md)

No deadline. Solo pace, phase by phase. A milestone is done when its exit criteria hold, not when the code compiles.

## Milestones

### M-1 — Skeleton and storage

**Goal.** An Electron app that starts, holds data, and talks to Ollama.
**Scope.** Electron + TypeScript + React scaffold; IPC boundary with `contextIsolation`; SQLite schema and migrations;
`LlmAdapter` with the Ollama implementation; startup detection of Ollama and the model list.
**Exit criteria.** The app launches, creates its database, lists installed models, and completes one round-trip prompt.
**Status.** **Done — 2026-09-03.** All four exit criteria verified against a real Ollama running `qwen3:4b`: the app
launches, creates and migrates its database, lists installed models, and completes a round-trip generation whose
constrained output parses. Model release via `keep_alive: 0` was verified too. 35 tests, clean typecheck, lint and
build.

Two settings were found by measuring rather than assuming, and both are now in the adapter: `think: false` and
`num_gpu: 99`. Together they took one generation from 82.8 s to 0.9 s at 100% GPU
([../operations/performance.md](../operations/performance.md)).

### M-2 — Research and primer cards

**Goal.** Typing a skill produces a card grounded in sources that are **actually about that skill**.
**Scope.** `SearchAdapter` (GitHub, official docs, Wikipedia); the **resolution stage** — deterministic
name gate plus the `resolve-source` model call ([ADR-0003](../architecture/adr/0003-source-resolution.md)); text
extraction and truncation; durable job queue with retry and model release; primer synthesis prompt; source storage
and display.
**Depends on.** M-1. The queue and resolution stages need no model — the stub adapter covers them end to end.
**Exit criteria.** Adding `nginx` yields a 1–2 page card with at least one working source link, generated in the
background without blocking the UI. **And:** adding `Zustand` grounds in the React state library or fails visibly —
never in the article about Pompeii.
**Status.** Not started. Scope grew after the resolution probes; see ADR-0003.

### M-3 — The skill graph

**Goal.** The app knows which of your skills are neighbours.
**Scope.** Classification into category + tags during research; relation computation; comparison-card generation;
relation display and manual correction.
**Depends on.** M-2.
**Exit criteria.** `nginx` and `Traefik` are linked and produce a comparison card naming a concrete difference;
`nginx` and `PostgreSQL` are not linked.
**Status.** Not started.

### M-4 — Questions that hold up

**Goal.** Four-option questions whose wrong answers are plausible.
**Scope.** Question generation prompt; sibling-skill distractor assembly; structural validation; explanations;
the user's "bad question" flag.
**Depends on.** M-3 — distractors need the graph.
**Exit criteria.** Generated questions pass validation, at least one distractor per related question traces to a
sibling skill, and the flag path works end to end.
**Status.** Not started. **This is the milestone the product lives or dies on.**

### M-5 — The daily loop

**Goal.** A reason to open the app tomorrow.
**Scope.** FSRS state and scheduling; daily-set assembly with configurable counts; progress persistence; empty states;
tray reminder at a user-set time.
**Depends on.** M-4.
**Exit criteria.** Two consecutive days produce different sets; closing and reopening resumes the same day; the
reminder fires only when the set is unfinished.
**Status.** Not started.

### M-6 — Keep and export

**Goal.** The good material survives outside the app.
**Scope.** Favourites with notes; Markdown export grouped by skill with sources preserved.
**Depends on.** M-5.
**Exit criteria.** A favourited card and question export to readable Markdown with working source links.
**Status.** Not started.

### M-7 — Eval harness

**Goal.** Quality is measured, not assumed.
**Scope.** Fixed eval set; automated checks for grounding, distractor plausibility, and schema conformance;
a run across at least two models to settle the model-dependent prompt question.
**Depends on.** M-4.
**Exit criteria.** `npm run eval` produces a comparable score; a deliberate prompt regression is caught by it.
**Status.** Not started. **Can start in parallel with M-5.**

### M-8 — Shippable

**Goal.** Someone other than the author can install and use it.
**Scope.** Settings UI (language, counts, reminder, model, optional key); setup screen; Windows installer;
CI build; README and license.
**Depends on.** M-6.
**Exit criteria.** A clean Windows VM installs the app, is guided through Ollama setup, and reaches a daily set.
**Status.** Not started.

### M-9 — Thirty-day trial

**Goal.** The PRD's v1 milestone.
**Scope.** Author uses it daily with 10 skills for 30 days; flagged questions and noticed errors are logged.
**Depends on.** M-8.
**Exit criteria.** 30 days of usable daily sets with no noticed factual error; flag rate recorded as the baseline.
**Status.** Not started.

## Dependencies

```text
M-1 ──▶ M-2 ──▶ M-3 ──▶ M-4 ──┬──▶ M-5 ──▶ M-6 ──▶ M-8 ──▶ M-9
                              └──▶ M-7
```

External dependencies: Ollama availability and model quality (M-1 onward); search provider stability (M-2 onward).
Both are tracked as risks in [../product/prd.md](../product/prd.md) and mitigated by the adapter boundary.

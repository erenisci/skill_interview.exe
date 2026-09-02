---
title: Release Plan
discipline: project
status: active
updated: 2026-09-02
---

# Release Plan

> **Purpose.** How a version gets from the working tree to a user's machine.
> **Related.** [definition-of-done.md](definition-of-done.md) · [../operations/deployment.md](../operations/deployment.md) · [../operations/ci-cd.md](../operations/ci-cd.md)

## Versioning

[SemVer](https://semver.org/). For a desktop app with a local database:

| Bump      | Meaning here                                                                                    |
| --------- | ----------------------------------------------------------------------------------------------- |
| **Major** | A migration that cannot be rolled back, or a change that invalidates existing generated content |
| **Minor** | New features, new prompts, additive schema changes                                              |
| **Patch** | Fixes with no schema or prompt change                                                           |

Pre-1.0 the app is not considered stable; `0.x.y` minor bumps may still break things, and that is stated in the README.

**Prompt versions are separate.** Every generated artefact stores its `prompt_version`. A prompt change is at least a
minor bump because it changes output, even when no code path changes.

## Release Checklist

1. `npm run typecheck && npm run lint && npm test` — all green
2. `npm run eval` — score is not below the previous release's baseline ([../llm/eval-harness.md](../llm/eval-harness.md))
3. Migrations applied against a copy of a real database, then the app opened against it
4. `CHANGELOG.md` `[Unreleased]` promoted to the new version with today's date
5. Version bumped in `package.json`
6. `npm run build` produces the Windows installer
7. Installer tested on a **clean Windows VM**: install → Ollama setup screen → add a skill → reach a daily set
8. Upgrade tested: install the previous version, use it, install the new one over it, confirm data survives
9. Git tag `vX.Y.Z`, push, attach the installer to the GitHub release
10. `/acta:track` to sync docs

## Cadence

No schedule. A release happens when a milestone from [roadmap.md](roadmap.md) meets its exit criteria.
Solo project, no deadline — shipping something half-done to hit a date has no upside here.

## Environments

There is no server, so "environments" means build configurations:

| Environment | What it is                                                                    |
| ----------- | ----------------------------------------------------------------------------- |
| **dev**     | `npm run dev`, hot reload, database in the project directory, verbose logging |
| **release** | Packaged installer, database in `%APPDATA%/skill-interview/`, normal logging  |

No staging environment exists or is needed. The clean-VM install test is the closest equivalent and it is mandatory.

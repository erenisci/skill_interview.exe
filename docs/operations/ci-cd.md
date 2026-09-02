---
title: CI/CD
discipline: ops
status: active
updated: 2026-09-02
---

# CI/CD

> **Purpose.** What runs automatically on every push, and what deliberately does not.
> **Related.** [deployment.md](deployment.md) · [../project/release-plan.md](../project/release-plan.md)

GitHub Actions, on Windows runners — this is a Windows-only product, so building anywhere else proves nothing.

## Pipeline Stages

| Stage                    | Command                                               | Blocks merge |
| ------------------------ | ----------------------------------------------------- | ------------ |
| Install                  | `npm ci`, with the Electron native rebuild            | Yes          |
| Type check               | `npm run typecheck`                                   | Yes          |
| Lint                     | `npm run lint`                                        | Yes          |
| Unit + integration tests | `npm test`                                            | Yes          |
| E2E                      | `npm run test:e2e` — Playwright with stubbed adapters | Yes          |
| Build                    | `npm run build` — produces the Windows installer      | Yes          |
| Package                  | Upload the installer as a workflow artifact           | No           |

**The eval suite does not run in CI.** It needs a real model, which means a multi-gigabyte download and a GPU-less
runner producing results that would not match a user's machine. Worse, the judged metrics — groundedness, distractor
plausibility, ambiguity — require a human reviewer ([../llm/eval-harness.md](../llm/eval-harness.md)). It is run
locally, and the release checklist enforces it.

This is a deliberate gap. CI proves the code works; it cannot prove the content is good.

## Triggers

| Event                  | Runs                                                           |
| ---------------------- | -------------------------------------------------------------- |
| Push to a branch       | Full pipeline                                                  |
| Pull request to `main` | Full pipeline                                                  |
| Push to `main`         | Full pipeline                                                  |
| Tag `v*`               | Full pipeline, plus attach the installer to the GitHub release |
| Manual dispatch        | Full pipeline — for testing the workflow itself                |

Nothing deploys anywhere. There is no server, so "CD" means producing a signed installer and attaching it to a
release, and a human decides when that happens.

## Gates

Merging to `main` requires:

- All blocking stages green.
- [../engineering/self-review-checklist.md](../engineering/self-review-checklist.md) walked.
- If a prompt changed: a local eval run, with its scores recorded in the eval results table.

Tagging a release additionally requires the full manual checklist in
[../project/release-plan.md](../project/release-plan.md), including the clean-VM install and the upgrade over a
populated database. Neither can be automated meaningfully, and both catch the failures that matter most.

## Secrets

The workflow needs **no application secrets**, because the app has none — the default search path is key-less and the
only credential the product can hold belongs to the user, on their machine.

The one repository secret that may exist later is a **code-signing certificate** for the Windows installer, to avoid
the SmartScreen warning on first run. Not present in v1; it is a paid certificate and the product is free. When it is
added, it is a GitHub encrypted secret used only in the tag workflow, never exposed to pull-request builds from forks.

No secret is ever echoed, written to a log, or committed ([security.md](security.md)).

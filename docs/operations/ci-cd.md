---
title: CI/CD
discipline: ops
status: active
updated: 2026-09-05
---

# CI/CD

> **Purpose.** What runs automatically on every push, and what deliberately does not.
> **Related.** [deployment.md](deployment.md) · [../project/release-plan.md](../project/release-plan.md)

GitHub Actions, on Windows runners — this is a Windows-only product, so building anywhere else proves nothing.

**Wired today** (`.github/workflows/ci.yml`): install, type check, lint, test, a compile-only build, the E2E suite,
and — on a tag
or a manual dispatch — the Windows installer, uploaded as a workflow artifact. Packaging is kept off ordinary
branch pushes deliberately: it downloads Electron, rebuilds a native module and emits ~120 MB, which is not worth
doing per commit.

**Wired since 2026-09-05:** the E2E stage, as a step of `build` rather than a job of its own — it launches the
binary the previous step just compiled, so a separate job would only rebuild it. It needs no `playwright install`:
the tests drive the app's own Electron, not a browser. On failure the HTML report is uploaded, which is how a
failure that will not reproduce locally gets read.

## Pipeline Stages

| Stage                    | Command                                            | Blocks merge | Wired                             |
| ------------------------ | -------------------------------------------------- | ------------ | --------------------------------- |
| Install                  | `npm ci`, with the Electron native rebuild         | Yes          | Yes                               |
| Type check               | `npm run typecheck`                                | Yes          | Yes                               |
| Lint                     | `npm run lint`                                     | Yes          | Yes                               |
| Unit + integration tests | `npm test`                                         | Yes          | Yes                               |
| E2E                      | `npx playwright test` — drives the compiled app    | Yes          | Yes — a step of `build`           |
| Build                    | `npm run build` — compiles the app, no installer   | Yes          | Yes                               |
| Package                  | `npm run package` — produces the Windows installer | No           | Yes — on tags and manual dispatch |

**The eval suite does not run in CI.** It needs a real model, which means a multi-gigabyte download and a GPU-less
runner producing results that would not match a user's machine. Worse, the judged metrics — groundedness, distractor
plausibility, ambiguity — require a human reviewer ([../llm/eval-harness.md](../llm/eval-harness.md)). It is run
locally, and the release checklist enforces it.

This is a deliberate gap. CI proves the code works; it cannot prove the content is good.

## Triggers

| Event                  | Runs                                                    |
| ---------------------- | ------------------------------------------------------- |
| Push to a branch       | Wired stages                                            |
| Pull request to `main` | Wired stages                                            |
| Push to `main`         | Wired stages                                            |
| Tag `v*`               | Wired stages, plus the installer as a workflow artifact |
| Manual dispatch        | Wired stages — for testing the workflow itself          |

Nothing deploys anywhere. There is no server, so "CD" means producing an installer and attaching it to a release,
and a human decides when that happens. The installer is produced; attaching it to a GitHub release is still a manual
step, and it is **unsigned** — there is no certificate, so first run shows SmartScreen.

## Gates

Merging to `main` requires:

- All wired blocking stages green — install, type check, lint, test, the compile-only build, and the E2E suite.
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

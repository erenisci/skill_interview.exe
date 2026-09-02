---
title: Git Workflow
discipline: code
status: active
updated: 2026-09-02
---

# Git Workflow

> **Purpose.** How work moves from a branch to a tagged release, sized for one person on a public repository.
> **Related.** [naming-conventions.md](naming-conventions.md) · [../project/release-plan.md](../project/release-plan.md)

## Branching

Trunk-based. `main` is always installable.

- One branch per unit of work, off `main`: `feat/…`, `fix/…`, `docs/…`, `chore/…`.
- Short-lived — a branch that outlives a few days means the task was too big and should have been split
  ([../project/definition-of-ready.md](../project/definition-of-ready.md)).
- No `develop`, no release branches. A solo project does not need parallel integration lines.
- Direct commits to `main` are acceptable for docs and typos; anything touching `src/` gets a branch.

## Commit Convention

Conventional Commits, format in [naming-conventions.md](naming-conventions.md).

- One logical change per commit. Unrelated cleanups are their own commit, even when noticed mid-task.
- A commit compiles and passes tests on its own. `git bisect` should be usable.
- Prompt changes get their own commit and say so in the subject: they change product output without changing a code path.
- Dependency bumps are never mixed with features.
- Generated content, the local database, and `SCRATCH.md` are never committed — see the `.gitignore` block.

## PR / merge

The repository is public but solo, so pull requests are optional and used when they help:

- **Merge directly** for small, self-contained work once CI is green.
- **Open a PR** when the change deserves a written record — an architectural change, a prompt rewrite, anything with
  an eval-score movement worth attaching a number to.
- Squash-merge branches with messy history; rebase-merge clean ones. Never merge red CI.
- Before merging, walk [self-review-checklist.md](self-review-checklist.md). It replaces the second reviewer.

If contributors ever appear, PRs become mandatory and this section gets rewritten — not before.

## Tags / Releases

- Releases are tagged `vX.Y.Z` on `main`, matching `package.json`.
- A tag is created only after the checklist in [../project/release-plan.md](../project/release-plan.md) passes, including
  the clean-VM install and the upgrade-over-real-data test.
- The Windows installer is attached to the GitHub release; installers are never committed to the repository.
- `CHANGELOG.md` is promoted from `[Unreleased]` to the version in the same commit that bumps `package.json`.

## Committing a phase

When a milestone from [../project/roadmap.md](../project/roadmap.md) meets its exit criteria: sync the docs with
`/acta:track`, then make one focused commit for the phase. Pushing stays a manual decision.

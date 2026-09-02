---
title: Definition of Done
discipline: project
status: active
updated: 2026-09-02
---

# Definition of Done

> **Purpose.** The bar a task must clear before it counts as finished.
> **Related.** [definition-of-ready.md](definition-of-ready.md) · [../engineering/self-review-checklist.md](../engineering/self-review-checklist.md)

A task is **Done** when:

## It works

- [ ] The acceptance criteria from its requirement hold.
- [ ] It was exercised in the running app, not only in tests.
- [ ] Edge cases from the feature spec behave as specified — especially the failure paths.
- [ ] Errors are handled per [../operations/error-handling.md](../operations/error-handling.md); nothing fails silently.

## It is tested

- [ ] New logic has unit tests: validators, scheduler, relation computation, text extraction.
- [ ] Prompt or generation changes have eval coverage and `npm run eval` did not regress.
- [ ] `npm run typecheck && npm run lint && npm test` pass.

## It is safe

- [ ] No secret, key, or user content is written to logs or the repository.
- [ ] Retrieved web content is still treated as data, never as instructions ([../llm/guardrails.md](../llm/guardrails.md)).
- [ ] The IPC boundary was not widened without reason; the renderer gained no direct database or network access.

## It performs

- [ ] The model is not left resident after the job queue drains.
- [ ] The read path still touches only SQLite ([../operations/performance.md](../operations/performance.md)).

## It is documented

- [ ] The affected doc is updated in place — not appended to, not duplicated.
- [ ] A significant decision has an ADR.
- [ ] Known compromises are recorded in [tech-debt.md](tech-debt.md) rather than left in someone's head.
- [ ] `CHANGELOG.md` `[Unreleased]` has an entry if the change is user-visible.
- [ ] `SCRATCH.md` notes drained by `/acta:track`.

## It is reviewed

- [ ] [../engineering/self-review-checklist.md](../engineering/self-review-checklist.md) walked, not skimmed.
- [ ] The diff contains only this task. Unrelated cleanups are their own commit.

---
title: Self-Review Checklist
discipline: code
status: active
updated: 2026-09-02
---

# Self-Review Checklist

> **Purpose.** The second reviewer this project does not have. Walk it before every merge.
> **Related.** [../project/definition-of-done.md](../project/definition-of-done.md) · [../ai/ai-review-checklist.md](../ai/ai-review-checklist.md)

Read the diff as if someone else wrote it and you have to maintain it. Skimming your own work is how solo projects
accumulate the bugs nobody ever finds.

## Before Commit

- [ ] The diff contains only this task. Anything unrelated has been split out.
- [ ] No leftover debugging: `console.log`, commented-out code, hardcoded test values.
- [ ] No secret, key, path from my machine, or user content in code, logs, or fixtures.
- [ ] Commit message says what changed and, when not obvious, why.

## Correctness

- [ ] Failure paths are handled, not just the happy path. What happens when search returns nothing? When the model
      returns malformed JSON? When Ollama is stopped mid-job?
- [ ] Model output is parsed and narrowed, never cast.
- [ ] A job interrupted here leaves the database consistent and the job retryable.
- [ ] Re-running the same job does not duplicate rows.
- [ ] Every invariant in [../architecture/erd.md](../architecture/erd.md) still holds — especially: four options,
      exactly one correct, every card has a source.
- [ ] Nothing generated is written without `model` and `prompt_version`.

## Boundaries

- [ ] The renderer gained no database, network, or Node access.
- [ ] Pipeline code imports adapter interfaces, not implementations.
- [ ] New SQL lives in a repository.
- [ ] The IPC surface was not widened without a reason worth stating.

## Tests

- [ ] New logic in validators, the scheduler, relation computation, or extraction has unit tests.
- [ ] Tests cover the failure cases, not only the successful one.
- [ ] `npm run typecheck && npm run lint && npm test` pass.
- [ ] If a prompt changed: `npm run eval` ran and did not regress.

## Content quality

- [ ] Grounding survived: nothing lets the model write from memory when retrieval fails.
- [ ] Retrieved text is still delimited as data in the prompt, never concatenated as instructions.
- [ ] If generation changed, the effect on already-stored content is decided — leave, regenerate, or migrate.
- [ ] The change was considered against a model other than the one I tested on.

## Security

- [ ] Untrusted content — web text, model output — is rendered as text, not as markup or executed.
- [ ] No new outbound network call outside the research path.
- [ ] Nothing new is written outside the app's data directory.

## Performance

- [ ] The read path still touches only SQLite.
- [ ] The model is still released when the queue drains.
- [ ] No new query in the daily-set path lacks an index.

## Docs

- [ ] The affected doc is updated in place.
- [ ] A significant decision has an ADR; an accepted compromise is in [../project/tech-debt.md](../project/tech-debt.md).
- [ ] `CHANGELOG.md` has an entry if the change is user-visible.

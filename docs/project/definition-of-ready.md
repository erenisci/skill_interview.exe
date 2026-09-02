---
title: Definition of Ready
discipline: project
status: active
updated: 2026-09-02
---

# Definition of Ready

> **Purpose.** The bar a task must clear before work starts, so time is not spent building the wrong thing.
> **Related.** [definition-of-done.md](definition-of-done.md) · [../product/feature-specs.md](../product/feature-specs.md)

A task is **Ready** when:

## Understanding

- [ ] The user-visible outcome is stated in one sentence.
- [ ] It maps to a requirement in [../product/requirements-functional.md](../product/requirements-functional.md) or is an explicit exception.
- [ ] It belongs to a milestone in [roadmap.md](roadmap.md), or is deliberately out of band.

## Scope

- [ ] Its edge cases are listed, or [../product/feature-specs.md](../product/feature-specs.md) already covers them.
- [ ] What is _not_ included is stated — the scope-creep risk is named in the PRD for a reason.
- [ ] It is small enough to finish in one sitting; if not, it is split first.

## Design

- [ ] Its dependencies exist. Distractor work needs the skill graph; scheduling needs questions.
- [ ] If it introduces a significant technical decision, that decision is worth an ADR and the ADR is written first.
- [ ] If it touches the database, the migration is planned and forward-only.
- [ ] If it touches an external provider, it goes through the adapter, not around it.

## LLM-specific

- [ ] If it changes a prompt, the eval set that covers it exists — or is part of the task.
- [ ] If it changes generated output, the effect on already-stored content is decided (leave, regenerate, or migrate).
- [ ] Model-dependent behaviour is considered: will this hold on a model other than the one being tested?

## Verifiable

- [ ] There is a concrete way to tell whether it worked, beyond "it looks right."
- [ ] For content quality, that means an eval check, not a manual glance.

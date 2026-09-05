---
title: Testing Strategy
discipline: quality
status: active
updated: 2026-09-05
---

# Testing Strategy

> **Purpose.** What gets tested, how, and why the usual pyramid is not enough for this product.
> **Related.** [qa-checklist.md](qa-checklist.md) · [../llm/eval-harness.md](../llm/eval-harness.md)

## Philosophy

This product has **two independent failure modes**, and only one of them is a bug:

1. **The code is wrong** — a job hangs, a query misses an index, the scheduler returns yesterday's set.
   Caught by ordinary tests.
2. **The content is wrong** — the card states something false, a distractor is accidentally also true, the model
   answers in the wrong language. No unit test catches this, and it is the failure that kills the product.

So testing here is two systems: a normal test suite for deterministic code, and an **eval suite** for generation
quality. Neither substitutes for the other. A release needs both green.

The deterministic parts were designed to be testable on purpose — the scheduler, validators, relation computation,
and text extraction are pure functions over explicit inputs ([../engineering/coding-standards.md](../engineering/coding-standards.md)).

## Test Pyramid

| Layer           | Weight                | What it covers                                                                                                                                                                                   |
| --------------- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Unit**        | Most                  | Validators, FSRS scheduling, relation computation, text extraction, distractor assembly, slug normalization, migrations                                                                          |
| **Integration** | Some                  | Pipeline stages against a temp SQLite file with a stubbed `LlmAdapter` and `SearchAdapter`; queue crash-and-resume; repository queries                                                           |
| **End-to-end**  | Few — 11 (`e2e/`)     | The built app, launched per test against a throwaway `SKILL_INTERVIEW_DATA_DIR`: navigation, the IPC round trip behind adding a skill, refusals reaching the screen, and what survives a restart |
| **Manual**      | Per release           | The clean-VM install, the upgrade over real data, and the feel of the UI ([qa-checklist.md](qa-checklist.md))                                                                                    |
| **Eval**        | Gate on prompt change | Grounding, distractor plausibility, schema conformance, language correctness ([../llm/eval-harness.md](../llm/eval-harness.md))                                                                  |

**Adapters are stubbed in every automated test.** Tests never call Ollama or the network: they would be slow,
non-deterministic, and would fail for reasons unrelated to the code. Real providers are exercised by the eval suite
and by manual release testing.

**Where the suite actually stands: 421 unit and integration tests, and 11 E2E tests through the built app.**

The E2E layer is deliberately thin, and covers only what the layer below it cannot reach: that a channel renamed on
one side of the preload boundary breaks the build, that a `Result` the view forgets to unwrap is caught, that a
refusal reaches the screen rather than only being returned, and that what claims to be saved is on disk — proven by
relaunching a second process against the same directory.

**What it does not cover, on purpose: generation.** Writing a card needs a model and a live search, so an E2E run
would either take minutes and depend on the network, or assert against stubs and stop being end-to-end. That path
is measured instead by the eval harness against frozen sources ([../llm/eval-harness.md](../llm/eval-harness.md)),
which is the sharper instrument for it. So the suite runs with no model reachable, dismisses the setup screen, and
exercises everything downstream of it.

## Coverage Goals

No global coverage percentage — it rewards testing getters. Instead, specific areas must be covered:

| Area                 | Requirement                                                                           |
| -------------------- | ------------------------------------------------------------------------------------- |
| Question validation  | Every rejection rule has a test that trips it                                         |
| Scheduler            | Interval progression, lapses, empty-due state, day-boundary handling                  |
| Job queue            | Retry, terminal failure, resume after simulated crash, no duplicate rows on re-run    |
| Relation computation | Related pair, unrelated pair, reclassification invalidating old edges                 |
| Distractor assembly  | Sibling distractors preferred; fewer than three usable → question dropped, not padded |
| Migrations           | Each applies cleanly against the previous schema with data present                    |
| Extraction           | Login walls and JS-only pages discarded                                               |

## Tools

| Purpose              | Tool                                                        |
| -------------------- | ----------------------------------------------------------- |
| Unit and integration | Vitest                                                      |
| E2E through the app  | Playwright for Electron                                     |
| Type safety          | `tsc --noEmit` in CI                                        |
| Lint                 | ESLint                                                      |
| Eval                 | Custom runner in `evals/` — the checks are project-specific |

## What / When to Test

**Always test:** anything in the validators, scheduler, queue, or relation logic. These carry correctness and are
cheap to test because they are pure.

**Test at the integration level:** anything touching SQL or spanning pipeline stages. A migration bug and a
stage-ordering bug are both invisible to unit tests.

**Do not unit-test:** React presentation, IPC plumbing that only forwards, adapter code that only reshapes a
provider response — the stub would assert the mock.

**Run the eval suite when:** a prompt changes, the recommended model changes, distractor assembly changes, or before
any release. A prompt edit with no eval run is an untested change to product output.

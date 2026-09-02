---
title: Functional Requirements
discipline: product
status: active
updated: 2026-09-02
---

# Functional Requirements

> **Purpose.** Numbered, testable statements of what the system must do.
> **Related.** [prd.md](prd.md) · [feature-specs.md](feature-specs.md) · [requirements-nfr.md](requirements-nfr.md)

## Overview

Priorities: **P0** must ship in v1 · **P1** should ship in v1 · **P2** deferred.
Each requirement is written so it can be checked as pass/fail.

## Functional Requirements

### Skills

| ID    | Requirement                                           | Priority | Acceptance                                                                                 |
| ----- | ----------------------------------------------------- | -------- | ------------------------------------------------------------------------------------------ |
| FR-01 | The user can add a skill as free text.                | P0       | Entering `nginx` creates a skill row and enqueues a research job.                          |
| FR-02 | Duplicate skills are detected before creation.        | P1       | Adding `NGINX` when `nginx` exists offers the existing skill instead of creating a second. |
| FR-03 | The user can delete a skill.                          | P0       | Deleting removes its cards, questions, relations, and review history after confirmation.   |
| FR-04 | Each skill is assigned a category and tags at ingest. | P0       | After research completes, the skill has a non-empty category.                              |
| FR-05 | The user can correct a wrong category or tags.        | P1       | Editing recomputes that skill's relations.                                                 |

### Research and cards

| ID    | Requirement                                                         | Priority | Acceptance                                                               |
| ----- | ------------------------------------------------------------------- | -------- | ------------------------------------------------------------------------ |
| FR-10 | The pipeline retrieves web sources for each new skill.              | P0       | At least one source row with URL, title, publisher, license, fetch date. |
| FR-11 | A primer card of 1–2 pages is generated per skill.                  | P0       | Card body is non-empty and within the configured length band.            |
| FR-12 | Every card displays the sources it was generated from.              | P0       | Each card shows at least one clickable source link.                      |
| FR-13 | Card generation runs in the background without blocking the UI.     | P0       | The user can navigate freely while jobs run.                             |
| FR-14 | A failed job is retried and surfaces its error after final failure. | P0       | Three attempts, then a visible failed state with a retry action.         |
| FR-15 | The user can regenerate a card.                                     | P1       | Regeneration produces a new card version; the previous one is replaced.  |

### Skill graph and comparisons

| ID    | Requirement                                           | Priority | Acceptance                                                   |
| ----- | ----------------------------------------------------- | -------- | ------------------------------------------------------------ |
| FR-20 | Skills with overlapping category or tags are linked.  | P0       | Adding `Traefik` alongside `nginx` creates a relation.       |
| FR-21 | A comparison card is generated for each related pair. | P0       | The pair has a comparison card naming a concrete difference. |
| FR-22 | Unrelated skills are not linked.                      | P0       | `nginx` and `PostgreSQL` produce no relation.                |
| FR-23 | The user can see a skill's relations.                 | P1       | The skill view lists related skills.                         |

### Questions

| ID    | Requirement                                                        | Priority | Acceptance                                                                   |
| ----- | ------------------------------------------------------------------ | -------- | ---------------------------------------------------------------------------- |
| FR-30 | Questions are multiple choice with exactly four options.           | P0       | Every stored question has four options.                                      |
| FR-31 | Exactly one option is correct.                                     | P0       | Schema validation rejects zero or multiple correct options.                  |
| FR-32 | Distractors are drawn from sibling skills where a relation exists. | P0       | For a related skill, at least one distractor is traceable to a sibling.      |
| FR-33 | Options pass structural validation.                                | P0       | No "all/none of the above"; option lengths within the configured ratio.      |
| FR-34 | Answering reveals an explanation.                                  | P0       | Explanation covers both the correct option and why the chosen one was wrong. |
| FR-35 | The user can flag a bad question.                                  | P0       | Flagged questions leave rotation and are counted in quality metrics.         |
| FR-36 | The number of daily questions is configurable.                     | P0       | Setting M yields at most M questions per day.                                |

### Daily set and scheduling

| ID    | Requirement                                                | Priority | Acceptance                                                                   |
| ----- | ---------------------------------------------------------- | -------- | ---------------------------------------------------------------------------- |
| FR-40 | The app produces a daily set of cards and questions.       | P0       | Opening the app shows today's set.                                           |
| FR-41 | Item selection is driven by a spaced-repetition scheduler. | P0       | Reviewed items reappear per the FSRS interval, not at random.                |
| FR-42 | The daily set differs day to day.                          | P0       | Two consecutive days do not produce identical sets given sufficient content. |
| FR-43 | Progress within a day is persisted.                        | P1       | Closing and reopening resumes the same set.                                  |
| FR-44 | A reminder notification fires at a user-set time.          | P0       | A tray notification appears if the set is unfinished.                        |

### Favourites and export

| ID    | Requirement                                | Priority | Acceptance                                               |
| ----- | ------------------------------------------ | -------- | -------------------------------------------------------- |
| FR-50 | The user can favourite a card or question. | P0       | It appears in the favourites list.                       |
| FR-51 | The user can attach a note to a favourite. | P1       | The note persists and is included in export.             |
| FR-52 | Favourites export to a Markdown file.      | P0       | Export produces a readable `.md` with sources preserved. |

### Settings and setup

| ID    | Requirement                                                | Priority | Acceptance                                                                         |
| ----- | ---------------------------------------------------------- | -------- | ---------------------------------------------------------------------------------- |
| FR-60 | The app detects Ollama at startup.                         | P0       | If absent or unreachable, the setup screen appears instead of the main window.     |
| FR-61 | The user selects the content language.                     | P0       | New generation uses the selected language.                                         |
| FR-62 | The user can supply their own search API key.              | P1       | The key is stored locally and used instead of the default providers.               |
| FR-63 | The user can choose which Ollama model to use.             | P0       | The model list is read from Ollama; the choice is recorded on generated artefacts. |
| FR-64 | No credentials are ever written to the repository or logs. | P0       | Grep of logs and repo finds no key material.                                       |

---
title: Feature Specs
discipline: product
status: active
updated: 2026-09-05
---

# Feature Specs

> **Purpose.** Per-feature behaviour, states, and edge cases — the level of detail code is written against.
> **Related.** [requirements-functional.md](requirements-functional.md) · [../llm/architecture.md](../llm/architecture.md)

## Skill Ingest

**Summary.** The user types a technical skill; the system creates it and starts research.

**Behavior.** Input is trimmed and normalized to a slug for duplicate detection. A skill row is created with
status `pending` and a research job is enqueued. Classification (category + tags) happens as part of research,
not before, because the model needs the retrieved text to classify reliably.

**States.** `pending` → `researching` → `ready` · `failed`

**Edge Cases.**

- Case and spacing variants (`NGINX`, `nginx`) resolve to the same slug.
- Ambiguous names (`Go`, `Rust`) are researched as written; the user corrects the category if wrong.
- Nonsense input produces a card that fails validation and lands in `failed` rather than persisting noise.
- Adding a skill while offline queues the job; it runs when connectivity returns.

**Out of Scope.** Bulk import, CV file parsing, autocomplete from a skill taxonomy.

## Research & Primer Card

**Summary.** Retrieve sources for a skill and synthesize a 1–2 page primer grounded in them.

**Behavior.** Search providers are queried in order; results are fetched, stripped to text, and truncated to a
token budget. The model receives the retrieved text and is instructed to write only from it. The card is stored
with its sources, model id, and prompt version.

**States.** `queued` → `retrieving` → `synthesizing` → `validating` → `stored` · `failed`

**Edge Cases.**

- Zero usable sources → job fails visibly; no card is invented from model memory.
- Sources contradict each other → the card notes the disagreement rather than picking silently.
- Retrieved page is a login wall or JS-only → discarded at the extraction step.
- Output exceeds the length band → one reformat retry, then fail.

**Out of Scope.** PDF sources, paywalled content, video transcripts.

## Skill Graph & Comparison Cards

**Summary.** Detect which skills are related and explain how they differ.

**Behavior.** Each skill carries a category and tags. A relation is created when categories match or tags overlap
above a threshold. For each related pair, a comparison card is generated from both skills' stored sources.

**States.** Relations are recomputed when a skill is added, deleted, or reclassified.

**Edge Cases.**

- A skill related to many others produces a comparison explosion — cap comparisons per skill.
- Asymmetric usefulness: `nginx` vs `Traefik` is worth a card, `nginx` vs `HTTP` is not; relation strength gates generation.
- Reclassification invalidates existing comparison cards for that skill.

**Out of Scope.** Multi-way (three or more) comparisons.

## Question Generation

**Summary.** Produce validated four-option multiple-choice questions with explanations.

**Behavior.** Two sources, in this order.

**Contrast questions**, where the skill has a neighbour. Claims are generated per pair with both technologies in
view, one true of each and false of the other; the correct option is the skill's own claim and the wrong ones are
real claims belonging to other skills the user has. These are the sharper questions — a wrong answer that is a true
statement about something the reader also knows is the confusion an interview actually probes — so they are written
first, and distractors prefer genuine graph neighbours over anything else in the pool.

**Questions from the skill's own material**, which fill whatever is left and which are the whole answer for a skill
with no neighbour at all. The stem is written first and the four answers to it after, which is what makes the wrong
ones possible: they are real mechanisms that are wrong _for this question_ rather than sentences that must be false
about the world. Measured, the second shape scores 14 of 17 where the first scored 8 of 12 with half its "false"
statements actually true.

Every question passes the same structural validation before it is stored.

**Validation rules.**

- Exactly four options; exactly one marked correct.
- No "all of the above", "none of the above", or "both A and B".
- Option lengths within a bounded ratio of each other — length is the classic giveaway.
- No duplicate options after normalization.
- **No option names any technology in play.** The stem may name the skill — that is how an interviewer asks — and an
  option that names its own technology hands over the answer.
- **Nothing that is only trivia**: dates, version numbers, licences, authorship, popularity. Those separate two
  technologies perfectly and teach nothing.
- A contrast option carries a rationale naming which technology it describes. An option from the skill's own
  material carries none, because there is no such attribution to make and filler would say the same thing under
  every wrong answer in every export.

**States.** `generated` → `validated` → `active` · `rejected` · `flagged` (by the user)

**Edge Cases.**

- Distractor is accidentally also true → rejected; this is the main quality risk and the eval suite targets it.
- Fewer than three usable distractors → the question is dropped, not padded.
- A skill with no neighbour at all → asked about from its own material rather than left unaskable.
- The model returns malformed JSON → parse failure, retry, then fail.

**Out of Scope.** Free-text answers, code-completion questions, timed exams.

## Daily Set & Scheduling

**Summary.** Choose what the user sees today and record how it went.

**Behavior.** FSRS holds per-item state (due date, stability, difficulty, reps, lapses). On the first open of a day,
due items are drawn up to the user's configured N cards and M questions; new items fill any remainder. Each answer
or card acknowledgement updates scheduler state.

**States.** `not started` → `in progress` → `complete` (per day)

**Edge Cases.**

- Nothing due and no new content → an explicit empty state, never filler.
- Backlog after days away → capped at the configured count; the rest stays due.
- Clock change or timezone shift → day boundaries use local date, computed once per session.
- A flagged question leaves rotation without disturbing its skill's schedule.

**Out of Scope.** Streaks, gamification, leaderboards.

## Favourites & Export

**Summary.** Keep the good material and take it out of the app.

**Behavior.** Any card or question can be favourited, optionally with a note. Export writes a single Markdown file
grouped by skill, preserving explanations, notes, and source links.

**Edge Cases.**

- Favourited item whose skill is later deleted → the favourite is retained with a note that the skill is gone.
- Export with zero favourites → refused with a message, no empty file.

**Out of Scope.** PDF export, Anki deck export, cloud sync.

## Setup & Settings

**Summary.** Get the user from install to a working app, and hold their preferences.

**Behavior.** On launch the app probes Ollama and the installed model list. Missing runtime or model routes to the
setup screen with the exact commands to run. Settings cover the reminder, whether the app stays in the tray, whether
it starts with Windows, the model, the Ollama URL, and an optional GitHub token that only raises a search rate limit.
How much a day holds is set per skill rather than globally ([../operations/configuration.md](../operations/configuration.md)).

Each field saves on its own, on blur or on toggle, rather than behind a Save button, and is validated in the main
process ([../operations/configuration.md](../operations/configuration.md)) — so a bad value is refused at the field
that caused it instead of silently breaking the scheduler.

**Edge Cases.**

- Ollama installed but no model pulled → distinguish this from "Ollama missing"; the fix differs.
- Ollama on a non-default port → the URL is configurable.
- The selected model is removed from Ollama → detected on next generation, surfaced as a setting error.
- Changing the model or URL → takes effect immediately; the running model is released and the new one takes over
  without a restart.
- A value the app cannot use — an unparseable reminder time, an empty daily count → refused, the stored value is kept,
  and the screen reloads from storage rather than leaving the invalid value on screen looking accepted.
- Changing the content language mid-life → applies to new generation only; existing content is not retranslated.

**Out of Scope.** In-app model download, bundled inference.

---
title: QA Checklist
discipline: quality
status: active
updated: 2026-09-02
---

# QA Checklist

> **Purpose.** The manual pass before a release — the things automation cannot judge.
> **Related.** [testing-strategy.md](testing-strategy.md) · [../project/release-plan.md](../project/release-plan.md)

Run on a **clean Windows VM**, against the packaged installer, not a dev build.

## Setup and first run

- [ ] Installer completes on a machine with no Node and no Ollama.
- [ ] With Ollama absent, the setup screen appears with the exact commands to run — not a crash, not an empty window.
- [ ] With Ollama installed but no model pulled, the message distinguishes that case; the fix differs.
- [ ] With Ollama on a non-default port, the configurable URL works.
- [ ] First launch creates the database in `%APPDATA%/skill-interview/`, not the install directory.

## Skills and generation

- [ ] Adding `nginx` starts research with visible progress and does not block the UI.
- [ ] The primer card is 1–2 pages, in the selected content language, with at least one working source link.
- [ ] Adding `Traefik` creates a relation and produces a comparison card naming a **concrete** difference.
- [ ] Adding `PostgreSQL` creates no relation to `nginx`.
- [ ] `NGINX` is offered the existing skill instead of creating a duplicate.
- [ ] Nonsense input fails visibly rather than persisting an invented card.
- [ ] Killing the app mid-generation and restarting resumes or resets the job; the database is intact.
- [ ] Disconnecting the network mid-research surfaces an error and leaves the job retryable.

## Questions — the part that decides the product

- [ ] Every question has four options and exactly one correct answer.
- [ ] Read ten questions as an interviewer would: are the distractors plausible, or obviously filler?
- [ ] No option is accidentally also true.
- [ ] Option lengths do not give the answer away.
- [ ] No "all of the above" or "none of the above" appears.
- [ ] The explanation covers both the correct option and the one chosen.
- [ ] Flagging a bad question removes it from rotation.

## Daily set

- [ ] Two consecutive days produce different sets.
- [ ] Configured counts are respected.
- [ ] Closing and reopening mid-set resumes the same set.
- [ ] With nothing due and no new content, an explicit empty state appears — no filler.
- [ ] After several days away, the backlog is capped rather than dumped.
- [ ] The reminder fires at the set time, only when the set is unfinished, and opens the daily set when clicked.

## Favourites and export

- [ ] Cards and questions can be favourited, with a note.
- [ ] Export produces readable Markdown with explanations, notes, and working source links.
- [ ] Export with zero favourites is refused with a message rather than writing an empty file.
- [ ] A favourite whose skill was deleted survives and is marked.

## Language

- [ ] Switching content language applies to new generation only; existing content is untouched.
- [ ] Card text keeps technical terms intact rather than paraphrasing them into something an interview will not use.

## Performance and resources

- [ ] **The model runs fully on the GPU.** During generation, `ollama ps` reports `100% GPU`. Any CPU share means
      the weights plus KV cache no longer fit and generation has silently become minutes-long — check `num_ctx` and
      the truncation budget ([../operations/performance.md](../operations/performance.md)).
- [ ] Cold start to the daily set is under 3 seconds.
- [ ] During daily use, memory stays at the app baseline — the model is not resident.
- [ ] After generation completes, memory returns to baseline; the model is released.
- [ ] The UI stays responsive while jobs run.

## Privacy and safety

- [ ] With research idle, no outbound network traffic (verify with a network monitor).
- [ ] Logs contain no API key, no card content, no skill list.
- [ ] Card text renders as text — a source page containing markup or script does not execute.

## Upgrade

- [ ] Installing over the previous version preserves skills, cards, questions, and review history.
- [ ] Migrations apply once and the app opens against the migrated database.

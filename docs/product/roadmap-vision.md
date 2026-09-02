---
title: Product Vision & Roadmap
discipline: product
status: active
updated: 2026-09-02
---

# Product Vision & Roadmap

> **Purpose.** Where this product is going and in what order — the product view, not the execution plan.
> **Related.** [prd.md](prd.md) · [../project/roadmap.md](../project/roadmap.md)

## Vision

A developer should be able to hand a machine the list of things they claim to know and get back, every day, a small
amount of material that makes those claims true again. Not a course, not a chatbot — a quiet local tool that reads
the internet on your behalf and asks you the question the interviewer is going to ask.

The long-term shape: the app knows the _graph_ of what you know, not just the list. The value compounds as skills
accumulate, because the interesting material lives in the edges between them.

## Themes

| Theme                        | What it means                                                                     |
| ---------------------------- | --------------------------------------------------------------------------------- |
| **Grounded, not generated**  | Every claim traces to a source. A confidently wrong card is worse than no card.   |
| **The graph is the product** | Comparisons between the user's own skills are what nothing else offers.           |
| **Local by default**         | No account, no server, no telemetry. Privacy is not a feature to add later.       |
| **Sustainable daily habit**  | Small daily volume, user-controlled, pleasant enough to return to.                |
| **Honest about the model**   | Model and prompt version stamped on everything; quality is measured, not assumed. |

## Now / Next / Later

### Now — v1

- Skill ingest, research pipeline, primer cards with sources
- Skill graph and comparison cards
- Validated four-option questions with sibling-skill distractors and explanations
- FSRS-scheduled daily set with configurable counts
- Favourites and Markdown export
- Tray reminder
- Turkish/English content language
- Windows installer, Ollama-dependent

### Next

- Question-quality loop: flag data feeds prompt and validation improvements
- Expanded eval suite covering multiple models, closing the model-dependent prompt question
- Real Windows widget instead of a tray notification
- Optional cloud model via user-supplied API key
- PDF export

### Later

- Non-technical subject matter — the engine is already general
- Embedded inference (llama.cpp), removing the Ollama dependency
- Semantic relations via embeddings when tag overlap proves too coarse
- Linux and macOS builds

### Explicitly not planned

Mobile. Chat. Accounts and sync. Monetization.

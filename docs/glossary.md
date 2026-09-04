---
title: Glossary
discipline: knowledge
status: active
updated: 2026-09-02
---

# Glossary

> **Purpose.** Shared vocabulary so docs, code identifiers, and database columns use the same words.

## Terms (A-Z)

| Term                 | Meaning                                                                                                                                                   |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Adapter**          | The interface isolating an external provider (LLM runtime, search engine) from the pipeline, so a provider can be swapped without touching pipeline code. |
| **Card**             | A generated 1–2 page teaching text about one skill. Two kinds: **primer** (single skill) and **comparison** (two related skills).                         |
| **Content language** | The language generated cards and questions are written in. English only — Turkish was supported, measured and withdrawn ([TD-19](project/tech-debt.md)).  |
| **Daily set**        | The cards and questions surfaced for a given day, chosen by the scheduler.                                                                                |
| **Distractor**       | A wrong option in a multiple-choice question.                                                                                                             |
| **FSRS**             | Free Spaced Repetition Scheduler — the algorithm deciding when an item is due again.                                                                      |
| **Grounding**        | Requiring generated text to derive from retrieved source material rather than model memory.                                                               |
| **Job**              | One unit of background pipeline work (research a skill, write a card, generate questions), queued and retryable.                                          |
| **Ollama**           | The local LLM runtime the app depends on. Supplies the model over a local HTTP API.                                                                       |
| **Pipeline**         | The background chain: ingest → research → synthesize → relate → generate → validate → persist.                                                            |
| **Primer**           | A card introducing one skill on its own.                                                                                                                  |
| **Prompt version**   | An identifier stamped on every generated artefact recording which prompt template produced it, so regressions are traceable.                              |
| **Relation**         | An edge between two skills whose categories or tags overlap. Drives comparison cards and distractor selection.                                            |
| **Sibling skill**    | Another skill related to the current one; the source of plausible distractors.                                                                            |
| **Skill**            | A user-entered technical topic. The unit everything else hangs off.                                                                                       |
| **Source**           | A retrieved web document backing a card, stored with URL, publisher, license, and fetch date.                                                             |

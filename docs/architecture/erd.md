---
title: Entity Relationship Diagram
discipline: code
status: active
updated: 2026-09-02
---

# Entity Relationship Diagram

> **Purpose.** The shape of the data at a glance.
> **Related.** [database-design.md](database-design.md)

## ERD

```mermaid
erDiagram
    SKILLS ||--o{ SOURCES : "researched from"
    SKILLS ||--o{ CARDS : "explained by"
    SKILLS ||--o{ QUESTIONS : "tested by"
    SKILLS ||--o{ SKILL_RELATIONS : "relates to"
    SKILLS ||--o{ OPTIONS : "supplies distractors for"
    SKILLS ||--o{ CLAIMS : "separated by pair"

    CARDS ||--o{ CARD_SOURCES : "grounded in"
    SOURCES ||--o{ CARD_SOURCES : "cited by"
    CARDS ||--o{ QUESTIONS : "generates"
    CARDS ||--o{ CLAIMS : "written from"

    QUESTIONS ||--|{ OPTIONS : "has exactly 4"
    QUESTIONS ||--o{ QUESTION_FEEDBACK : "flagged for a reason"

    SKILLS {
        int id PK
        string name
        string slug UK
        string category
        string tags
        string status
        string content_lang
        string created_at
    }
    SKILL_RELATIONS {
        int skill_a_id PK,FK
        int skill_b_id PK,FK
        string kind
        real strength
    }
    SOURCES {
        int id PK
        int skill_id FK
        string url
        string title
        string publisher
        string license
        string fetched_at
        string excerpt
    }
    CARDS {
        int id PK
        int skill_id FK
        int related_skill_id FK "null unless comparison"
        string type "primer | comparison"
        string title
        string body_md
        string content_lang
        string model
        string prompt_version
        string created_at
    }
    CARD_SOURCES {
        int card_id PK,FK
        int source_id PK,FK
    }
    QUESTIONS {
        int id PK
        int skill_id FK
        int card_id FK
        string stem
        string explanation
        string difficulty
        string content_lang
        string model
        string prompt_version
        string status "active | rejected | flagged"
    }
    OPTIONS {
        int id PK
        int question_id FK
        string text
        string rationale
        int is_correct
        int source_skill_id FK "null = model-generated"
    }
    CLAIMS {
        int id PK
        int skill_id FK
        int contrast_skill_id FK "the skill this claim is false of"
        int card_id FK
        string text
        string model
        string prompt_version
        string created_at
    }
    QUESTION_FEEDBACK {
        int id PK
        int question_id FK
        string target "question | explanation"
        string reason
        string note
        string created_at
    }
    REVIEWS {
        int id PK
        string item_type "card | question"
        int item_id
        string reviewed_at
        int rating
        string due_at
        real stability
        real difficulty
        int reps
        int lapses
    }
    FAVORITES {
        int id PK
        string item_type
        int item_id
        string note
        string created_at
    }
    DAILY_SET_ITEMS {
        int id PK
        string set_date "local YYYY-MM-DD"
        string item_type "card | question"
        int item_id
        int position
        string completed_at "null until answered"
    }
    JOBS {
        int id PK
        string kind
        string payload
        string status
        int attempts
        string error
        string retry_at "not-before time of a backoff; null when due"
        string created_at
        string updated_at
    }
    SETTINGS {
        string key PK
        string value
    }
```

## Entities

| Entity                  | What it is                                                                                                           |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `SKILLS`                | The root entity. Everything else hangs off a skill.                                                                  |
| `SKILL_RELATIONS`       | The graph — the part of the product nothing else offers.                                                             |
| `SOURCES`               | Provenance. Holds the extracted text the model actually saw.                                                         |
| `CARDS`                 | Generated teaching text: a primer for one skill, or a comparison between two.                                        |
| `QUESTIONS` / `OPTIONS` | Generated assessment. Exactly four options, exactly one correct.                                                     |
| `CLAIMS`                | One statement, true of `skill_id` and false of `contrast_skill_id` — what questions borrow their wrong answers from. |
| `QUESTION_FEEDBACK`     | Why the user flagged a question or its explanation.                                                                  |
| `REVIEWS`               | FSRS state per reviewed item — an append-only log, one row per answer.                                               |
| `DAILY_SET_ITEMS`       | Which ids belong to today's set, frozen once assembled.                                                              |
| `FAVORITES`             | What the user chose to keep.                                                                                         |
| `JOBS`                  | The durable queue driving all generation.                                                                            |
| `SETTINGS`              | Key-value preferences.                                                                                               |

## Relationships

- A **skill** has many sources, cards, questions, and relations.
- A **comparison card** points at two skills: `skill_id` and `related_skill_id`.
- A **card** cites many sources, and a source may back many cards — hence `CARD_SOURCES`.
- A **question** belongs to the card it was generated from, which is how an answer traces back to a source.
- An **option** may point at the sibling skill its distractor came from; `NULL` marks a model-generated distractor.
- A **claim** points at two skills: `skill_id` (what it is true of) and `contrast_skill_id` (what it is false of, and
  therefore safe to show as a wrong answer about).
- `REVIEWS`, `DAILY_SET_ITEMS`, `FAVORITES`, `JOBS`, and `SETTINGS` reference items polymorphically or not at all, so
  they carry no foreign keys — deliberate, so deleting a skill cannot cascade away review history or a saved
  favourite.

## Invariants

1. Every card has at least one row in `CARD_SOURCES`. A card without provenance is a bug.
2. Every question has exactly four options, exactly one with `is_correct = 1`.
3. Every option has a non-empty `rationale`.
4. `skill_relations` stores each pair once, with `skill_a_id < skill_b_id`.
5. Every generated row carries `model` and `prompt_version`.
6. A favourite outlives its skill; the UI marks it orphaned rather than deleting it.

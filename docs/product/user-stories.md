---
title: User Stories
discipline: product
status: active
updated: 2026-09-02
---

# User Stories

> **Purpose.** The product expressed from the user's side, with acceptance criteria.
> **Related.** [requirements-functional.md](requirements-functional.md) · [feature-specs.md](feature-specs.md)

## Stories

### US-01 — Put my CV into the app

**As a** developer preparing for interviews
**I want** to type the technologies from my CV into the app
**So that** I get study material without writing any of it myself.

Acceptance:

- I can add a skill in one field and one action.
- I get feedback that research has started.
- If I add something I already have, I am offered the existing skill.

### US-02 — Get reminded what a technology actually is

**As a** developer who last touched a tool two years ago
**I want** a short primer I can read in a couple of minutes
**So that** I can describe the tool rather than just name it.

Acceptance:

- The primer fits in 1–2 pages.
- It is grounded in sources I can open and check.
- It targets refresher level, not a tutorial from zero.

### US-03 — Learn the difference between two things I claim to know

**As a** developer with both nginx and Traefik on my CV
**I want** the app to notice they are related and explain how they differ
**So that** the interview question I dread has an answer.

Acceptance:

- Related skills are detected without me linking them.
- The comparison names a concrete difference, not a generic contrast.
- Unrelated skills do not generate comparisons.

### US-04 — Be tested, not just shown

**As a** user who forgets what he only reads
**I want** multiple-choice questions each day
**So that** recall is exercised, not just recognition.

Acceptance:

- Four options, one correct.
- Wrong options are plausible — they come from my neighbouring skills.
- After answering I see why my option was wrong and why the right one is right.

### US-05 — Control the daily load

**As a** user with limited time
**I want** to set how many cards and questions I get per day
**So that** the habit is sustainable.

Acceptance:

- Counts are configurable.
- The set differs day to day.
- Unfinished progress resumes when I reopen the app.

### US-06 — Be nudged

**As a** user who forgets to open the app
**I want** a reminder at a time I choose
**So that** the streak survives a busy day.

Acceptance:

- The notification fires at the chosen time only when the set is unfinished.
- Clicking it opens the daily set.

### US-07 — Keep the good bits

**As a** user who found three explanations genuinely useful
**I want** to favourite them and export a document
**So that** I can review before an interview without the app.

Acceptance:

- Cards and questions can be favourited.
- Export produces readable Markdown with sources preserved.

### US-08 — Trust what I read

**As a** user who knows small models make things up
**I want** every claim linked to where it came from
**So that** I can verify anything that looks wrong.

Acceptance:

- Every card shows its sources.
- I can flag a bad question and it leaves rotation.

### US-09 — Study in my own language — **withdrawn 2026-09-04**

**As a** developer whose first language is not English
**I want** to choose the language of the generated content
**So that** I read in whichever language I absorb faster.

**Not delivered, and not deferred quietly.** Turkish was built, measured against a real model, and withdrawn:
claims kept coming back in English, and two fixes that worked elsewhere in this codebase did not move the number
([TD-19](../project/tech-debt.md)). The half-working version was worse than none — an English option inside a
Turkish question is a tell that hands the reader the answer.

The story stays here rather than being deleted, because it is a real need this product does not meet, and the
person it fails first is its author. It returns if a model is found that holds a second language on claims as well
as on prose.

### US-10 — Keep it on my machine

**As a** user who does not want a study account
**I want** the app to work without signing in or sending data anywhere
**So that** my CV and my gaps stay private.

Acceptance:

- No account, no server, no telemetry.
- The only outbound traffic is web research, and it is visible in settings.

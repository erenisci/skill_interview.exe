---
title: 'ADR 0003: Source resolution — grounding to the wrong subject is the real failure'
discipline: code
status: Accepted
date: 2026-09-02
---

# ADR 0003: Source resolution

## Status

Accepted — 2026-09-02
Corrected — 2026-09-03 (see below; the decision stands, one supporting detail was wrong)

## Correction — 2026-09-03

**The `in:name` change below was not supported by measurement, and the code does not do it.**
The original text is left intact rather than rewritten, because the point of an immutable ADR is that its
reasoning can be audited — including where it was wrong.

Seven skills, three query strategies, top result each:

| Strategy        | Correct | Notes                                                                                          |
| --------------- | ------- | ---------------------------------------------------------------------------------------------- |
| `sort=stars`    | **2/7** | The original problem: Redis → a 158k-star interview guide, nginx → an interview-questions repo |
| Plain relevance | **7/7** | What the code now does                                                                         |
| `in:name`       | **6/7** | Loses "Express.js" to `VerbalExpressions/JSVerbalExpressions` on a name substring              |

So **dropping `sort=stars` was the whole fix**; narrowing the field with `in:name` was unnecessary and cost a case.
The reasoning in the Decision section was right about the cause and wrong about the remedy.

Nothing else changes. Ranking remains a heuristic either way, every hit remains a candidate, and the two gates still
decide — which is precisely why the design does not depend on finding a perfect query. Evidence:
`evals/probes/github-query-probe.mjs`.

## Context

The retrieval design assumed a single failure mode: **no usable sources**, in which case the job fails visibly and
no card is written ([../../llm/guardrails.md](../../llm/guardrails.md)). Provider choice was therefore framed as a
coverage question — does Wikipedia or a web search return material for the technologies people actually list?

Two probes were run before building M-2. Both scripts are kept in `evals/probes/`.

**Probe 1 — coverage.** 20 skills spanning established technologies and modern tooling, measuring whether each
provider returned ≥1000 characters of text.

| Provider      | Coverage |
| ------------- | -------- |
| Wikipedia     | 90%      |
| GitHub README | 90%      |
| Official docs | 60%      |
| DuckDuckGo    | 95%      |

The number looked reassuring and was meaningless: it measured text volume, not whether the text was about the right
subject.

**Probe 2 — precision.** The same providers against deliberately ambiguous names:

| Skill       | Wikipedia returned                     | GitHub returned              |
| ----------- | -------------------------------------- | ---------------------------- |
| Zustand     | **Pompeii** (the Roman city)           | `pmndrs/zustand` ✓           |
| Drizzle ORM | **MySQL**                              | `drizzle-team/drizzle-orm` ✓ |
| Tauri       | **Tauri** (an ancient Crimean people)  | (rate limited)               |
| tRPC        | **TRPC** (cell ion channels)           | `calcom/cal.diy` ✗           |
| Vitest      | **Playwright** (a different test tool) | `slymnoyann/hey-1` ✗         |
| Traefik     | Traefik Proxy ✓                        | `traefik/traefik` ✓          |
| Redis       | Redis ✓                                | `Snailclimb/JavaGuide` ✗     |
| Express.js  | Express.js ✓                           | `processing/p5.js` ✗         |

Wikipedia was right 3 times out of 8; GitHub 3 out of 7 conclusive. **Every one of those wrong answers counted as
success in probe 1** — Zustand's 8,887 "usable" characters were about Pompeii.

GitHub's failure has a clear cause: `sort=stars` returns the most-starred repository _mentioning_ the term, not the
repository _of_ the term. Redis resolves to a 158k-star interview guide that happens to discuss Redis.

This exposes a failure mode the architecture had no defence against. **Grounding to the wrong subject is worse than
having no source at all.** A missing source fails the job visibly, which the design already guarantees. A wrong
source produces a fluent, confident card, complete with a working citation link — and nothing in the pipeline
notices. For a product whose single promise is that its content is trustworthy, this is the most damaging bug
available, and it was one naive `search()` call away.

## Decision

**Retrieval gains a resolution step. A search result is a candidate, never a source.**

Every candidate must pass two gates before its text is allowed to ground anything.

**Gate 1 — name match (deterministic, free).** The candidate's identity — article title, repository name — must
match the skill's normalized slug closely. Cheap, and on the probe sample it rejects every wrong answer above
(Pompeii, MySQL, TRPC, Playwright, JavaGuide, p5.js) while keeping every right one (`Traefik Proxy`, `Express.js`,
`drizzle-orm`, `pmndrs/zustand`).

**Gate 2 — subject check (one small model call).** Gate 1 is necessary and not sufficient: Wikipedia's article on the
ancient Tauri people is titled exactly `Tauri`, so an exact-title match accepts entirely the wrong subject. The
surviving candidates' titles and lead paragraphs are therefore passed to the model with one question — _which of
these, if any, is the technology named X_ — and it may answer "none". This is a classification task on short text,
which is where a small local model is at its most reliable.

Supporting changes:

- **GitHub search uses `in:name`**, not `sort=stars`. Ranking by popularity is what produced JavaGuide for Redis.
- **DuckDuckGo is dropped.** It returns links, which would still need both gates plus a page fetch and extraction,
  and the probes showed no capability the other providers lack. It was also the only provider with no API contract.
- **Zero candidates surviving the gates fails the job**, exactly as zero sources does today.

## Consequences

**Easier.**

- The product's core promise gets an actual mechanism behind it. "Grounding is absolute" now covers grounding to the
  _wrong_ thing, which it silently did not before.
- Failures move to where they are cheap: a rejected candidate is an empty state with a reason, not a plausible card
  the user has no way to distrust.
- Gate 1 is deterministic and free, so most bad candidates never reach the model at all.

**Harder.**

- **The pipeline gains a stage and a model call.** M-2 grows: `SearchAdapter` is no longer enough on its own, and
  there is a new prompt with its own eval coverage.
- **Gate 1 will reject legitimate sources.** A skill whose canonical article is titled differently from how the user
  typed it — an acronym, a rebrand, a vendor prefix — gets refused. The product bias is deliberate: refusing a
  correct source costs an empty state, accepting a wrong one costs the user's trust. Expect to loosen this with
  measurements, not with guesses.
- **Gate 2 inherits the model-quality variance** of [TD-04](../../project/tech-debt.md). A model that misclassifies
  here poisons everything downstream. It is a short, structured classification, which is the most robust thing to ask
  of a small model — but it must be in the eval set from the start.
- Every retrieval now costs an extra round trip before any content is written.

**At scale.** Resolution is per skill and happens once, at research time. It adds nothing to the daily read path.

<!-- ADRs are per-item and immutable except Status. To change a decision, add a new ADR that supersedes this one. -->

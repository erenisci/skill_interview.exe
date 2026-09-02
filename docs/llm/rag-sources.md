---
title: RAG Sources
discipline: llm
status: active
updated: 2026-09-02
---

# RAG Sources

> **Purpose.** Where retrieved material comes from, how it is processed, and what its licensing obliges us to do.
> **Related.** [architecture.md](architecture.md) · [guardrails.md](guardrails.md)

## Corpora

There is no pre-built corpus. Sources are fetched per skill, at research time, and stored with the card they produced.

| Provider           | Default | Key        | Role and risk                                                                                                                                          |
| ------------------ | ------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **GitHub API**     | Yes     | None       | Primary for tools. Searched with `in:name`, never `sort=stars`. README plus the declared homepage. 60 req/h unauthenticated, 5000 with a user token    |
| **Official docs**  | Yes     | None       | Fetched from the homepage the repository declares — no search step to get it wrong                                                                     |
| **Wikipedia API**  | Yes     | None       | Secondary, and best for **concepts** rather than tools: "what is a reverse proxy", "what is a JVM". Requires a descriptive User-Agent; 429s under load |
| **Tavily / Brave** | No      | User's own | Optional upgrade. Entered in settings, stored locally                                                                                                  |

**DuckDuckGo was removed.** It returned only links, which would still need fetching, extraction, and both resolution
gates; the probes showed no capability the other providers lack, and it was the one provider with no API contract.

**No API key ships in the repository.** An open-source project cannot embed one, so the default path must work
without any key.

Provider failure degrades rather than fails: if GitHub is rate-limited, Wikipedia alone can still produce a card.
Only zero **resolved** sources fails the job — see below.

## Resolution — a search result is a candidate, not a source

Added by [ADR-0003](../architecture/adr/0003-source-resolution.md) after measurement showed the original design had
no defence against retrieving the wrong subject entirely. Searching "Zustand" returned the Wikipedia article on
**Pompeii**; "Redis" on GitHub returned a 158k-star interview guide that merely mentions Redis. Both would have
produced fluent, confident, fully-cited cards about the wrong thing.

Every candidate passes two gates before its text may ground anything:

1. **Name match** — deterministic and free. The article title or repository name must match the skill's normalized
   slug closely. On the probe sample this alone rejected every wrong answer and kept every right one.
2. **Subject check** — one small model call. Gate 1 is not sufficient: Wikipedia's article on the ancient Tauri
   people is titled exactly `Tauri`. Surviving candidates' titles and lead paragraphs go to the model with a single
   question — which of these, if any, is the technology named X — and "none" is a valid answer.

If nothing survives both gates the job fails visibly, exactly as zero sources does. **A refused source costs an
empty state; a wrong source costs the user's trust in every card they have ever read.**

## Chunking

Deliberately simple, because the retrieval unit is small:

1. Resolve candidates to sources (above). Only these proceed.
2. Fetch the resolved pages.
3. Extract text from HTML; strip scripts, markup, and navigation.
4. Discard login walls, JS-only shells, and empty extractions.
5. Truncate to a per-job token budget, favouring the opening sections — for reference documentation the definitional
   material is at the top.
6. Pass the whole retained text to the model in one prompt.

No sliding-window chunking, no re-ranking. One skill produces a few documents, which fit in context. Machinery that
would only matter for a large corpus is not added.

## Embeddings

**None in v1.** Relations between skills come from category and tag overlap assigned during classification, not from
vector similarity ([TD-03](../project/tech-debt.md)).

The trigger for adding them is evidence, not preference: if flag data shows comparison cards failing because the tag
heuristic paired the wrong things, `sqlite-vec` embeddings move from Later to Now.

## Retrieval

Retrieval happens once per skill, at research time — not per question and not per daily set. Generated cards and
questions are stored artefacts; the daily read path touches only SQLite and never the network
([../architecture/overview.md](../architecture/overview.md)).

Stored per source: URL, title, publisher, license, fetch date, and the **extracted excerpt the model actually saw**.
The excerpt is what makes "was this grounded or invented?" answerable after the fact.

## Refresh

No automatic refresh in v1. Cards are snapshots of what the sources said on their fetch date, and that date is shown.

- The user can regenerate a card manually, which re-runs retrieval.
- Stale sources are visible rather than hidden: the fetch date is part of the card.
- Automatic refresh is not planned. Technical fundamentals move slowly, and a background job that silently rewrites
  material the user has already reviewed would break the spaced-repetition state.

## Licensing and attribution

**The code license and the content license are different things**, and this is easy to get wrong.

| Layer                       | License                                            |
| --------------------------- | -------------------------------------------------- |
| Application code            | MIT                                                |
| Wikipedia-derived card text | CC BY-SA — attribution and share-alike obligations |
| Other web sources           | Their own terms; varies                            |

Consequences that must hold in the product:

- Every card displays its sources, with links. This is a requirement (FR-12), not a courtesy.
- Markdown export carries the source links through, for the same reason.
- Publisher and license are stored per source so attribution can be generated correctly rather than guessed.
- The MIT license in `LICENSE` covers the code only; the README states that generated content follows its sources'
  licenses.

This is tracked as a risk in [../product/prd.md](../product/prd.md). If the product ever distributes generated
content rather than generating it locally per user, the share-alike question needs a real answer first.

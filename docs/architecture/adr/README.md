# Architecture Decision Records

Significant technical decisions, one file each. An ADR records _why_, _what else was considered_, _why not those_,
and _what it costs_ — so a decision can be revisited on its reasoning rather than re-argued from scratch.

ADRs are **immutable except for their Status**. To change a decision, write a new ADR that supersedes the old one.

## Index

| ADR                                   | Title                                                                                        | Status   | Date       |
| ------------------------------------- | -------------------------------------------------------------------------------------------- | -------- | ---------- |
| [0001](0001-initial-architecture.md)  | Initial architecture — Electron + TypeScript, local-first, generation split from consumption | Accepted | 2026-09-02 |
| [0002](0002-constrained-decoding.md)  | Constrained decoding for structured output — JSON Schema at the runtime, plus a parse        | Accepted | 2026-09-02 |
| [0003](0003-source-resolution.md)     | Source resolution — a search result is a candidate, never a source                           | Accepted | 2026-09-02 |
| [0004](0004-claim-based-questions.md) | Claim-based question assembly — distractors are neighbours' claims, gated before use         | Accepted | 2026-09-03 |
| [0005](0005-feedback-as-eval-data.md) | Feedback is eval data, not training data                                                     | Accepted | 2026-09-03 |
| [0006](0006-pairwise-claims.md)       | Pairwise claims, separated during generation — supersedes ADR-0004's gate                    | Accepted | 2026-09-03 |
| [0007](0007-fsrs-scheduler.md)        | FSRS via `ts-fsrs`, long-term mode, two-point rating                                         | Accepted | 2026-09-03 |

## When to write one

Write an ADR when a choice would be expensive to reverse or would confuse someone reading the code later:

- Choosing or replacing a framework, database, or external dependency
- Changing where a boundary sits (what the renderer may do, what an adapter hides)
- Committing to an algorithm the product depends on (scheduling, distractor assembly)
- Accepting a significant trade-off, especially one that costs performance or quality

Not every decision needs one. Routine choices go in [../../engineering/coding-standards.md](../../engineering/coding-standards.md);
knowingly accepted compromises go in [../../project/tech-debt.md](../../project/tech-debt.md).

## Corrections versus supersession

The two are different, and mixing them destroys the audit trail either way:

- **A changed decision** gets a **new ADR** that supersedes the old one. The old one keeps its text and gains a
  `Superseded by` status.
- **A factual detail that turned out to be wrong** — a measurement, an API behaviour, a claim about a library — gets a
  dated **Correction** section at the top of the same ADR, with the original text left standing below it. Leaving a
  known-wrong instruction in an accepted ADR is worse than the small violation of immutability, because someone will
  implement it.

ADR-0003 carries an example: its decision holds, but one supporting claim about a search parameter did not survive
being measured.

ADR-0004 carries both at once, which is what the distinction is for. Its correction records the measurement that
falsified an assumption; [ADR-0006](0006-pairwise-claims.md) then supersedes the mechanism that assumption supported,
while ADR-0004's framing of the problem still stands and is still worth reading.

## Format

Copy the shape of ADR-0001: Status · Context · Decision · Consequences. Number sequentially, four digits,
kebab-case title. Update the index table above when adding one.

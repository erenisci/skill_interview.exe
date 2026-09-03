# Probes

One-off measurement scripts, kept because a decision was made on their output.

These are **not** the eval harness ([../../docs/llm/eval-harness.md](../../docs/llm/eval-harness.md)) — they take no
fixed inputs and produce no scored baseline. They exist so the evidence behind an ADR can be re-run rather than
taken on trust.

| Script                   | Question                                                           | Informed                                                                                                           |
| ------------------------ | ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------ |
| `coverage-probe.mjs`     | Does each provider return enough text for 20 real skills?          | [ADR-0003](../../docs/architecture/adr/0003-source-resolution.md) — and showed the question was wrong              |
| `precision-probe.mjs`    | Is the text about the **right subject**?                           | [ADR-0003](../../docs/architecture/adr/0003-source-resolution.md) — the decision rests on this                     |
| `github-query-probe.mjs` | Which GitHub query strategy resolves a name to the project itself? | The correction in [ADR-0003](../../docs/architecture/adr/0003-source-resolution.md) — `in:name` did not survive it |

| `resolve-probe.mjs` | Can a small local model answer "none"? | The second gate of [ADR-0003](../../docs/architecture/adr/0003-source-resolution.md) — 5/5, three of them refusals |

```bash
node evals/probes/coverage-probe.mjs
node evals/probes/precision-probe.mjs
node evals/probes/github-query-probe.mjs
node evals/probes/resolve-probe.mjs   # needs Ollama running
```

Both hit public APIs unauthenticated and throttle accordingly; the coverage probe takes a few minutes. Wikipedia
returns HTTP 429 if you remove the delays — an early run did, and the resulting gaps looked like missing articles
rather than rate limiting. Read the output with that in mind.

**The lesson worth keeping:** the coverage probe reported 90% and was measuring the wrong thing. Zustand's
"usable" 8,887 characters were the Wikipedia article on Pompeii. A measurement that does not check what it is
counting is worse than no measurement, because it is believed.

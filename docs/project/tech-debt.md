---
title: Technical Debt Log
discipline: project
status: active
updated: 2026-09-02
---

# Technical Debt Log

> **Purpose.** Compromises we accepted on purpose, with the cost written down so they stay visible.
> **Related.** [../architecture/adr/README.md](../architecture/adr/README.md) · [definition-of-done.md](definition-of-done.md)

Debt taken knowingly is a decision; debt discovered later is a surprise. This file exists to keep the first kind
from becoming the second. Items are added as they are accepted, not after they hurt.

## Debt items

### TD-01 — Ollama as a hard external dependency

**What.** The app cannot generate anything unless the user installs Ollama and pulls a model.
**Why it exists.** Bundling llama.cpp means shipping GPU backends and per-platform binaries, plus an in-app
multi-gigabyte download. That is weeks of build work before the product exists.
**Cost.** The largest onboarding drop-off in v1. Also puts model quality outside our control.
**Remediation.** Embedded inference, planned for Later ([../product/roadmap-vision.md](../product/roadmap-vision.md)).
The `LlmAdapter` boundary exists specifically so this is one implementation, not a rewrite.

### TD-02 — DuckDuckGo HTML scraping has no contract — **closed 2026-09-02**

**What.** One of the two default search providers was scraped, not an API.
**Why it existed.** No free, key-less general web search API exists. Shipping a key in an open-source repo is not an option.
**Cost.** It would have broken without warning, silently.
**Closed by.** [ADR-0003](../architecture/adr/0003-source-resolution.md) removed it. Coverage probes showed it
offered nothing the GitHub and Wikipedia paths lack, and its links would still have needed fetching, extraction, and
both resolution gates. Dropping it removed the only provider with no API contract.

### TD-03 — Tag overlap as the relation heuristic

**What.** Skills are related by category match and tag overlap, not by meaning.
**Why it exists.** Embeddings plus a vector index is more machinery than a first version needs, and the model
already produces tags during research at no extra cost.
**Cost.** Both error directions: missed relations between things that are genuinely comparable, and spurious ones
that generate useless comparison cards.
**Remediation.** `sqlite-vec` embeddings, listed under Later. Triggered when the flag rate on comparison cards
shows the heuristic is the cause.

### TD-04 — Prompts are tuned against one model

**What.** Prompts will be written and tuned against a single model, but users choose their own.
**Why it exists.** Testing every model against every prompt before the product exists is not affordable.
**Cost.** A user on a different model may get worse distractors, weaker grounding discipline, or wrong-language
output — and it will look like a product bug.
**Reduced, 2026-09-02.** [ADR-0002](../architecture/adr/0002-constrained-decoding.md) sends a JSON Schema with every
request, so malformed output is no longer part of this debt: schema conformance is a runtime guarantee rather than a
per-model prompt-following skill. What remains is content quality.
**Remediation.** M-7 runs the eval suite across at least two model families. The outcome decides between a
supported-model allowlist and per-model prompt variants. Tracked as an open question in
[../product/prd.md](../product/prd.md).

### TD-05 — Electron memory baseline accepted

**What.** ~200 MB of baseline footprint from the shell alone.
**Why it exists.** The alternative was Rust/Tauri, i.e. learning a new language before writing any product code.
Weighed in [../architecture/adr/0001-initial-architecture.md](../architecture/adr/0001-initial-architecture.md).
**Cost.** The stated performance goal is met only because the model is unloaded between jobs. There is no headroom
if the UI itself grows heavy.
**Remediation.** None planned. Guarded by a budget in [../operations/performance.md](../operations/performance.md);
a UI that inflates the baseline is treated as a defect.

### TD-06 — No content versioning on regeneration

**What.** Regenerating a card replaces the old one; the previous version is not kept.
**Why it exists.** Version history is meaningful only once prompts change often enough to compare.
**Cost.** A regression introduced by a prompt change cannot be diffed against what the card used to say.
**Remediation.** Cheap to add later — `model` and `prompt_version` are already stored per artefact, so a history
table is additive.

### TD-07 — The recommended model is a hypothesis, not a measured result — **reframed 2026-09-02**

**What.** `qwen3:4b` is now both the development and the recommended model, chosen because an 8B Q4 (~5 GB) does not
fit the 4 GB laptop GPU this is built on — a common configuration. Nothing has yet shown that 4B clears the quality
bar.
**Why it exists.** Choosing before measuring was unavoidable: the eval harness needs a working pipeline, and the
pipeline needs a model. Picking the small one first means the risk surfaces early rather than after the product is
tuned around hardware most users do not have.
**Cost.** If 4B falls short, prompts tuned against it may need reworking for a larger model, and the recommendation
changes.
**Remediation.** M-7 asks "does 4B clear the bar", not "which size". The falsifying conditions are written down in
[../llm/architecture.md](../llm/architecture.md); any of them escalates to 8B.

### TD-09 — One model installed, so cross-family variance is unmeasurable

**What.** Only `qwen3:4b` is installed, by choice: the model in development is deliberately the one in production.
**Why it exists.** A second model answers a question that does not block v1. Note this is **not** a disk constraint —
the development machine has 585 GB free — it is a decision to keep dev and production identical.
**Cost.** [TD-04](#td-04--prompts-are-tuned-against-one-model) cannot be closed. The allowlist-versus-variants
decision stays open, and prompt fragility across model families stays unmeasured.
**Remediation.** Cheap whenever it matters: pull a second family (`gemma3:4b`) and re-run the eval sets. Nothing in
the design has to change for it — the model is a setting.

### TD-08 — Toolchain pinned by a peer-dependency conflict

**What.** `vite`, `@vitejs/plugin-react`, and `vitest` are pinned to majors that predate the latest releases.
**Why it exists.** `electron-vite@5` caps at `vite@7`, while the current `@vitejs/plugin-react` requires `vite@8`.
**Cost.** A blind `npm update` breaks the install; the three packages move together or not at all.
**Remediation.** Lift when `electron-vite` supports `vite@8`. Recorded in [../maintenance.md](../maintenance.md).

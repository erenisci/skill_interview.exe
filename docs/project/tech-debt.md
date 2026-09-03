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

### TD-10 — Resolution cannot tell a technology from the tooling around it

**What.** Searching "PostgreSQL" returns Ansible roles and Chef cookbooks named `postgresql`, and resolution picks
one roughly two runs in three. Measured 2026-09-03: one run chose Wikipedia's PostgreSQL article and classified it
well (`database`, `relational`, `mvcc`, `replication`); two chose `ANXS/postgresql`, whose README is about installing
PostgreSQL rather than what it is, and produced a single useless tag.
**Why it exists.** Both gates were designed for the _wrong subject_ problem — Pompeii for Zustand. A deployment role
genuinely is about the technology, so neither the name gate nor the subject check has grounds to reject it. The
prompt now names this case explicitly, which helped but did not settle it.
**Cost.** The card is written from packaging documentation rather than from the project, and the skill usually ends
up unclassified, so it joins no comparisons. It is **not** a wrong claim — the card describes what the source says —
but it answers the wrong question.
**Contained by.** Classification failure no longer fails the job, so the outcome is a visible degradation rather
than a lost card, and a tag equal to the skill's own name is now discarded.
**Remediation.** These cases belong in `disambiguation.jsonl` so M-7 measures the fix instead of guessing at it.
Prompt tuning by hand against three runs is how a fix gets believed without being verified.

### TD-11 — The question quality thresholds are guesses

**What.** Three numbers gate whether a generated question reaches the user, and none has been checked against real
output: `MAX_LENGTH_RATIO` (2.5) in the structural validator, the 4–8 claim band asked of the claim prompt, and
`TARGET_QUESTIONS` (5) per skill.
**Why it exists.** They were needed before there was any generated corpus to calibrate against, exactly as the
primer's `MIN_BODY_CHARS` was. Picking a plausible number and labelling it provisional was preferable to blocking
M-4 on data that does not exist yet.
**Cost.** A ratio set too tight silently drops usable questions; too loose and the oldest multiple-choice tell —
the correct option being the long careful one — survives into the product. Neither shows up as a failure.
**Contained by.** Every dropped candidate logs why, so the drop reasons are recoverable from the logs rather than
lost.
**Remediation.** Calibrate against a corpus in M-7, the way the name gate was calibrated against a table of
must-pass and must-fail pairs. Tuning these by hand until the output looks good is the mistake ADR-0003's correction
already records.

### TD-12 — The discrimination gate rejects almost every distractor

**What.** Measured 2026-09-03 with `evals/probes/question-probe.mjs` against `qwen3:4b`, on nginx, HAProxy and
Apache HTTP Server: **1 of 28 borrowed claims survived the gate (4%)**. Three are needed per question, so no
question could be assembled for any of the three skills. This was logged as a risk before it was measured; the
measurement turned it into a blocker.
**Why it exists.** The gate rejects only when the material **explicitly contradicts** the claim. Probed on
unambiguous cases it correctly kept "uses the process name httpd" and "is released under the Apache License 2.0" —
in both the nginx material states the opposite. Where the material is merely silent it answers "could be true",
in its own words because "the material does not indicate that it does not have this capability". Material about one
technology is silent about nearly everything another technology does, so the tie-breaker in
`discriminate-claim.v1.md` — "if the material does not settle it, answer `true`" — rejects nearly everything. The
safe default was the fatal one.
**Cost.** Question generation produces nothing for skills whose neighbours are similar, which is precisely the case
the product is built around. The app has cards and no questions.
**Contained by.** Nothing. This is a blocker, not an accepted compromise, and it is recorded here only until the
successor ADR replaces the mechanism.
**Remediation.** Not a threshold to nudge — asking "could this be true of X?" against material about X lets the
model reason only from absence. The candidate fix is to move discrimination into generation, where the model sees
both technologies at once and is already known to do well (the comparison card proves it). Recorded as a correction
on [ADR-0004](../architecture/adr/0004-claim-based-questions.md); the replacement needs its own ADR.

### TD-13 — Claims come back generic instead of distinguishing

**What.** In the same run, asked for claims about HAProxy the model returned properties true of the whole category:
"supports HTTP/2 and HTTP/3", "event-driven multithreaded architecture", "SSL/TLS termination", "load balancing".
`question-claims.v1.md` asks for what is distinctive and says generic properties make worthless options.
**Why it exists.** A skill is described on its own, with no neighbour in view, so the model has nothing to contrast
against and falls back on what the category shares. Apache's claims were specific by comparison — but specific in
the wrong way (market share, the NCSA lineage, the licence), which is trivia rather than understanding.
**Cost.** A generic claim is correctly rejected by the gate, so it wastes a model call; used as the _correct_ option
it makes a question that teaches nothing.
**Contained by.** Nothing yet.
**Remediation.** Shares a root cause with [TD-12](#td-12--the-discrimination-gate-rejects-almost-every-distractor):
both come from judging one technology in isolation. A fix that generates claims per pair would address both, and
should be measured before it is believed.

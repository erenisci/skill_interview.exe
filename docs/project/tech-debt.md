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

### TD-10 — Resolution cannot tell a technology from the tooling around it — RESOLVED

**What.** Searching "PostgreSQL" returns Ansible roles named `postgresql`, and resolution picked one roughly two runs
in three. Measured 2026-09-03.
**What it turned out to be.** Not a judgement problem. The model's stated reasoning was correct all along — it
described the Ansible role as packaging rather than the technology — while the `index` it returned said otherwise,
because the schema made it commit to a number before writing a word of reasoning
([ADR-0002](../architecture/adr/0002-constrained-decoding.md), correction).
**Now.** With `reason` ordered before `index`, the frozen `ANXS/postgresql` case answers "none" correctly, and the
full disambiguation set scores 7/7 including all three refusals (`npm run eval`, 2026-09-04).
**Kept as a regression case.** `postgresql-ansible-role` and `postgresql-both` stay in `evals/sets/disambiguation.jsonl`
so a future prompt or schema change that reintroduces this is caught rather than rediscovered.

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

### TD-12 — Nothing independently checks that a distractor is false — RESOLVED, with a residue

**What.** Measured 2026-09-03: the separate discrimination gate left **1 of 28** borrowed claims standing (4%), and
no question could be assembled. Replaced by pairwise generation
([ADR-0006](../architecture/adr/0006-pairwise-claims.md)); re-measured on four reverse proxies, **6 of 6 pairs
separated and 4 of 4 skills became askable**.
**The residue.** The gate was a second, separately-verifiable opinion about whether a wrong answer was really wrong.
There is no longer one. If the model says a claim is false of the target and it is not, nothing downstream catches
it — the structural validator checks form, not truth.
**Cost.** A question with two correct options can reach the user. That is the worst defect a question has, because
the reader answers correctly and is told they are wrong.
**Contained by.** The user's `ambiguous` flag, which exists for exactly this and takes the question out of rotation
on the first sighting ([ADR-0005](../architecture/adr/0005-feedback-as-eval-data.md)).
**Remediation.** Track the `ambiguous` flag rate per prompt version in M-7. If it is low, the single judgement is
enough and this closes; if not, the answer is a second opinion that compares the two claims against each other —
never the material-absence question that failed the first time.

### TD-13 — Claims still come back as trivia

**What.** `contrastive-claims.v1.md` forbids separating on popularity, licensing, age, origin, or process names, and
the model produces them anyway: "serves 23.7% of the busiest websites", "is released under the Apache License 2.0",
"runs under Unix as the HTTP daemon process named httpd". Measured 2026-09-03, after the rule was strengthened once.
**Why it exists.** Trivia separates two technologies perfectly, which is what the prompt asks for, and it is the
easiest separation to find in an encyclopedia article. The rule against it competes with the rule the model is
succeeding at.
**Cost.** A question that tests whether the reader memorised a licence. It is not wrong, and it is not what the
reader came for.
**Contained by.** Partly, and by accident: the trivia claims measured so far tend to be long run-on sentences that
`MAX_LENGTH_RATIO` rejects. That is luck, not a mechanism.
**Remediation.** Belongs in the eval set as a scored property rather than another prompt round — this rule has been
strengthened once already with no measured effect, which is the signal to stop hand-tuning
([TD-10](#td-10--resolution-cannot-tell-a-technology-from-the-tooling-around-it) records the same lesson).

### TD-14 — A skill needs three researched neighbours before it can be asked about

**What.** A pair of similar technologies yields roughly one usable separating claim per side, so three wrong answers
require three neighbours. A user with three skills gets cards and no questions.
**Why it exists.** Pushing the prompt for more claims per side was measured: it returns four, and all four name their
own technology while the separation degrades. Quantity bought at the cost of the rules that matter is not quantity
([ADR-0006](../architecture/adr/0006-pairwise-claims.md)).
**Cost.** The app looks unfinished for a small skill list, and the empty state has to explain something subtle.
**Contained by.** The questions view says why there is nothing yet rather than showing an empty panel.
**Remediation.** Revisit if a larger model yields more claims per pair — this is a good candidate for the
two-model comparison in M-7, since it is one number that decides how the product feels on day one.

### TD-15 — Cards and questions collapse to a two-point FSRS rating

**What.** FSRS is built for a self-graded four-point scale (again/hard/good/easy). This product only ever sends
`again` or `good`: a question's outcome is derived from correct/incorrect, and a card offers two buttons with the
same two meanings. `hard` and `easy` are never produced.
**Why it exists.** Neither signal this product actually has is finer than binary — there is no self-reported
confidence step, by design ([ADR-0007](../architecture/adr/0007-fsrs-scheduler.md)).
**Cost.** FSRS's weights were tuned expecting all four ratings to appear across real usage; running only the
extremes is a supported configuration but an under-exercised one. Whether the resulting intervals are as good as a
four-point signal would produce is unmeasured.
**Contained by.** Nothing needed — this is a chosen trade-off, not a defect, and the wrapper already accepts any
`ReviewRating`, so adding a third or fourth value later is a UI change, not a scheduler change.
**Remediation.** Not urgent. If real use ever shows the daily set schedules items too aggressively or too loosely,
this is the first place to look before touching the algorithm itself.

### TD-16 — The reminder has no persistent tray icon

**What.** FR-44 asks for "a tray notification"; this ships a plain OS `Notification` (a toast) at the configured
time, not a persistent Windows system-tray icon with a menu.
**Why it exists.** A real icon asset does not exist in this repository yet — no design pass has produced one — and
Electron's `Notification` satisfies the acceptance criterion (a notification appears when the set is unfinished)
without inventing a placeholder icon file to unblock a `Tray` instance that would otherwise show a blank glyph.
**Cost.** No quick way to reopen the app from the tray without the reminder having fired first, and no persistent
"is something due" indicator between reminders.
**Contained by.** Clicking the notification focuses (or creates) the main window, so the one interaction FR-44
actually asks for works.
**Remediation.** Add a real `Tray` with an icon once the app has one — the same icon M-8's Windows installer needs,
so this is naturally M-8 work rather than a separate pass.

### TD-17 — A sign-in page can still produce a card

**What.** Measured 2026-09-04 (`npm run eval`, refusal set): of two pages with no article behind them, the cookie
banner was correctly refused and the sign-in wall was not — the model wrote a card about Redis from a page that
contains no Redis at all. Refusal rate 50%.
**Why it exists.** Refusal is currently enforced by length, not by grounding: `synthesizePrimer` rejects a body under
`MIN_BODY_CHARS`. A cookie banner produces too little to pass that bar; a sign-in wall has enough words in it that the
model can fill the space, and what fills it comes from its own memory rather than the page.
**Cost.** The exact failure the product's first rule exists to prevent — a fluent, confident card with no source
behind it. It is worse than a visible failure precisely because it looks like a success.
**Contained by.** Nothing. Length is a proxy for grounding and this is where the proxy breaks.
**Remediation.** The prompt already says to report gaps rather than fill them; that is not enough on its own. The
candidate fix is a cheap deterministic pre-check — a page whose extracted text never mentions the skill is not
material about that skill — applied before synthesis rather than after. Measure it against this set rather than
assuming it works.

### TD-18 — Turkish is requested and English is delivered

**What.** Measured 2026-09-04 (`npm run eval`, language set): both Turkish cases came back as English prose. Language
accuracy 33% — the only pass was the English case. Technical terms survived untranslated in all three, so the term
rule works; the language rule does not.
**Why it exists.** The language is passed as a prompt parameter (`LANGUAGE: Turkish`) and nothing enforces it. A 4B
model with an English source in front of it and an English system preamble above it follows the weight of the
context rather than one line of instruction.
**Cost.** Turkish is one of the two content languages the product offers ([FR-61](../product/requirements-functional.md)).
Offering a language that silently returns another one is worse than not offering it.
**Contained by.** Nothing yet. The setting is selectable and the output is wrong.
**Remediation.** Unmeasured options, in rough order of cost: state the language requirement last rather than first in
the prompt, since recency wins under constrained decoding; move it into the system preamble; or reject non-matching
output in `synthesizePrimer` the way length is rejected, using the same detector the eval scores with. The detector
already exists and is tested — reusing it as a runtime guard costs almost nothing.

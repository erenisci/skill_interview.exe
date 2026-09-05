# skill_interview.exe

Turns the technical skills on your CV into a few minutes of interview practice a day — primer
cards and multiple-choice questions, written by a **local** model from sources it actually
retrieved, scheduled by spaced repetition.

Windows desktop. No account, no server, no telemetry. The only thing that leaves your machine
is a web search for the skills you add.

> **Status: usable, not finished.** Everything works end to end and there is an installer. What
> it has not had is weeks of real use. [docs/progress.md](docs/progress.md) is kept honest
> rather than optimistic, including the parts that do not work.

---

## What it does

You type `PostgreSQL`. In the background it searches GitHub, the project's own documentation
and Wikipedia, decides which result is really about PostgreSQL, and writes a primer card from
the text it retrieved — with the sources shown, so you can check it.

Then it asks you about it. Every day, a small set: a card, then the questions drawn from that
card, then the next one. You answer, it schedules the next review, and you close the app.

Add a second skill and it does something more interesting. It works out whether the two are
comparable, writes a card explaining how they actually differ, and starts building questions
whose **wrong answers are true statements about your other skills** — the confusion a real
interview probes, rather than three obviously wrong options.

## The four rules it is built on

These are the whole design, and everything else follows from them.

**1 · Generation is split from consumption.** The model runs only in background jobs and is
released when the queue drains. Opening the app touches SQLite and nothing else — no model
call, no HTTP request, ever. A study app you wait ten seconds for is a study app you stop
opening.

**2 · Grounding is absolute.** Cards are written from retrieved text. Zero usable sources
fails the job, visibly. There is no path where the model writes from memory, because a card
that is fluent and wrong is worse than no card — and it looks exactly like a correct one.

**3 · Wrong answers are assembled, not invented.** Where a skill has a neighbour, they are real
claims about it, generated with both technologies in view. Where it has none, the question is
written stem-first from the skill's own material, so the wrong answers are real mechanisms that
are wrong _for that question_. Questions failing validation are dropped, never padded.

**4 · Boundaries hold.** Renderer → IPC → services → adapters. No database or network in the
renderer; no concrete adapter imported outside its folder.

## Quality is measured, not claimed

`npm run eval` runs the **shipped** pipeline over frozen sources and scores what a machine can
settle: grounding refusal, resolution accuracy, prompt-injection resistance, schema conformance.
Groundedness, distractor plausibility and ambiguity are written to a review file for a person,
deliberately — an LLM judging its own family agrees with exactly the mistakes that matter most.

It earns its keep. Its first run found a bug two milestones old that had silently disabled the
"none of these sources is right" refusal. Current scores, and the ones that are still weak, are
in [docs/llm/eval-harness.md](docs/llm/eval-harness.md).

Several designs in here were measured and thrown away rather than shipped — a discrimination
gate that left 1 of 28 distractors standing, a Turkish content language that could not be made
reliable, a material filter that damaged the sources it was meant to improve. Those are recorded
in [docs/project/tech-debt.md](docs/project/tech-debt.md) with the numbers that killed them.

## Getting started

Windows, [Ollama](https://ollama.com), and one model:

```bash
ollama pull qwen3:4b     # ~2.5 GB

npm install
npm run dev              # run it
npm test                 # 421 unit and integration tests
npm run eval             # quality metrics — needs Ollama running
npm run package          # build a Windows installer into release/
```

On first launch the setup screen lists the models Ollama has and lets you pick one. Changing it
later takes effect immediately, without a restart.

**A 4 GB GPU is enough, and that is deliberate.** `qwen3:4b` fits entirely in VRAM on a mid-range
laptop; an 8B model does not, and silently spills onto the CPU. Check with `ollama ps` — it
should say `100% GPU`. The reasoning, and what would overturn it, is in
[docs/llm/architecture.md](docs/llm/architecture.md).

The app also runs with **no model installed**: generation is stubbed and everything else works,
which is rule 1 doing its job.

The installer is **unsigned**, so Windows shows a SmartScreen warning on first run. That is the
honest state of a free app without a paid certificate, not a bug.

## Built with

Electron · TypeScript · React · SQLite (better-sqlite3, FTS5) · Ollama · FSRS (`ts-fsrs`) ·
Vitest · electron-builder

## Documentation

This repository is documented more heavily than its size warrants, on purpose: the decisions are
the interesting part, and most of them are only defensible with the measurement that produced
them. Full index in [docs/](docs/README.md).

| Start here                                                | For                                   |
| --------------------------------------------------------- | ------------------------------------- |
| [ai-context.md](docs/ai/ai-context.md)                    | The five-minute briefing              |
| [prd.md](docs/product/prd.md)                             | What it is for, and what it is not    |
| [architecture/overview.md](docs/architecture/overview.md) | How the pieces fit                    |
| [ADRs](docs/architecture/adr/README.md)                   | Why, and what was rejected            |
| [llm/architecture.md](docs/llm/architecture.md)           | How the model is used, and its limits |
| [tech-debt.md](docs/project/tech-debt.md)                 | What is knowingly wrong, and its cost |
| [onboarding.md](docs/onboarding.md)                       | Clean machine to running build        |

## License

[MIT](LICENSE) for the application code.

Generated card content is a different matter: it derives from web sources under their own
licenses, and Wikipedia-derived text carries CC BY-SA attribution obligations. Cards therefore
always display their sources — that is a requirement, not a courtesy. See
[docs/llm/rag-sources.md](docs/llm/rag-sources.md).

The same applies inside this repository: `evals/sources/` holds frozen Wikipedia extracts used by
the eval suite, under CC BY-SA 4.0 rather than MIT. Each file's origin and licence is recorded in
[evals/sources/README.md](evals/sources/README.md).

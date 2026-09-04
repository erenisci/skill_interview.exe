# Changelog

All notable changes to this project are documented here.
Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) · Versioning: [SemVer](https://semver.org/).

<!-- acta:track adds entries under [Unreleased], and promotes them to a version on release.
     APPEND-LOG: never rewrite past versions. Newest on top. -->

## [Unreleased]

### Added

- Electron + TypeScript + React application scaffold, with the renderer sandboxed and all privileged work behind typed IPC.
- SQLite storage: full initial schema, forward-only migrations, and repositories for skills, settings, and the job queue.
- `LlmAdapter` with an Ollama implementation and a model-free stub, including model-release (`keep_alive`) and JSON-Schema-constrained decoding.
- Startup readiness check that tells "Ollama missing", "no model pulled", and "selected model gone" apart.
- Skills view: add, list, and remove skills; setup screen for a missing or unconfigured model.
- Durable background job queue: retries transient failures with a backoff that survives a restart, gives up after a
  limit, resumes work interrupted by a crash, and releases the model once the queue drains.
- Research pipeline: adding a skill now searches GitHub, its declared documentation and Wikipedia, resolves which
  result is actually about that skill, and writes a grounded primer card stored with its source and licence.
- Skills view shows a finished card with its sources, and follows a skill's progress while research runs.
- Skill graph: research classifies each skill and links it to comparable neighbours, and a strongly related pair gets
  a comparison card explaining what actually differs between them.
- Multiple-choice questions, assembled by code from atomic claims: the right answer is a claim about the skill, and
  the three wrong ones are real claims belonging to three of its graph neighbours. A question that cannot find three
  usable distractors is dropped rather than padded.
- Flagging a bad question or a bad answer, with a required reason and a target — recorded as measurable eval data,
  never fed back to the model as training.
- Daily set: a small mix of cards and questions, scheduled by FSRS, assembled once per local day and frozen so
  reopening the app resumes the same set. A question flagged after assembly still disappears.
- Optional reminder notification at a configured time, and only when the day's set is unfinished.
- Favourites: star any card or question, add a note, and export the lot as one Markdown file grouped by skill with
  every source as a followable link.
- Eval suite (`npm run eval`) — six frozen sets run through the shipped pipeline, scoring what a machine can settle
  and writing the rest to a review file for a person.
- Settings screen: daily counts, reminder, content language, model, Ollama URL, and an optional GitHub token that
  only raises a rate limit. Every field is validated in the main process, and a refused value is restored on screen
  rather than left looking accepted.
- Windows installer (`npm run package`) — NSIS, the app's own icon, and an uninstall that leaves the user's database
  in place. Built in CI on a tag or on request.
- Tray icon with an Open/Quit menu and a tooltip reflecting whether today's set is still unfinished.

### Changed

- Generation requests now disable the model's reasoning trace and force every layer onto the GPU. Measured on a
  4 GB laptop GPU, one generation went from 82.8 s to 0.9 s at full context.
- Selecting a model in setup or settings now takes effect immediately, releasing the running model and swapping the
  new one in, instead of requiring a restart.
- Claims are generated per **pair** of skills, with both in view, rather than per skill and filtered afterwards. The
  original design left 1 of 28 distractors standing and produced no questions at all.

### Fixed

- Source resolution asked the model for its answer before its reasoning. Under constrained decoding that means
  committing before thinking, so the model's own explanation contradicted the index it had already emitted, and the
  "none of these" refusal never fired. Reordering the two fields took the disambiguation set from 1/4 to 7/7.
- Research no longer accepts material that never names the skill it is supposed to be about — a sign-in page could
  previously ground a card.
- A card requested in Turkish is now written in Turkish. The language requirement was being stated too early in the
  prompt to survive to the end of generation.
- Question explanations no longer refer to options by position, which is meaningless once the options are shuffled.
- Re-running question generation for a skill no longer rebuilds the same questions from the same claims.

### Removed

## [0.1.0] - 2026-09-02

### Added

- Initial project scaffold: documentation set and Acta brain.

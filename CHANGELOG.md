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

### Changed

- Generation requests now disable the model's reasoning trace and force every layer onto the GPU. Measured on a
  4 GB laptop GPU, one generation went from 82.8 s to 0.9 s at full context.

### Fixed

### Removed

## [0.1.0] - 2026-09-02

### Added

- Initial project scaffold: documentation set and Acta brain.

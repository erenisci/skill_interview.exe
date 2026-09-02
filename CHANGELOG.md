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

### Changed

### Fixed

### Removed

## [0.1.0] - 2026-09-02

### Added

- Initial project scaffold: documentation set and Acta brain.

---
title: Maintenance
discipline: knowledge
status: active
updated: 2026-09-02
---

# Maintenance

> **Purpose.** The recurring work that keeps this project healthy between features.
> **Related.** [project/tech-debt.md](project/tech-debt.md) · [operations/security.md](operations/security.md)

## Routine Tasks

| Task                                 | Cadence                                         | Why                                                                                                                          |
| ------------------------------------ | ----------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Run the eval suite                   | Before every release, and after any prompt edit | Prompt changes regress silently otherwise — see [llm/eval-harness.md](llm/eval-harness.md)                                   |
| Re-test the default search providers | Monthly                                         | Run `evals/probes/precision-probe.mjs` — a provider that starts resolving to the wrong subject is worse than one that breaks |
| Review flagged questions             | Monthly                                         | User "bad question" flags are the main quality signal                                                                        |
| Check new Ollama model releases      | Quarterly                                       | The recommended model list in [llm/architecture.md](llm/architecture.md) goes stale                                          |
| Verify installer on a clean VM       | Before every release                            | Catches missing native module rebuilds                                                                                       |
| Prune orphaned sources and cards     | Quarterly                                       | Deleted skills leave rows behind                                                                                             |

## Dependencies

| Dependency       | Risk                                              | Handling                                                         |
| ---------------- | ------------------------------------------------- | ---------------------------------------------------------------- |
| Electron         | Major versions break native modules               | Upgrade one major at a time; rebuild `better-sqlite3` after each |
| `better-sqlite3` | Native module, must match Electron's ABI          | `electron-rebuild` runs in postinstall                           |
| Ollama           | External, user-installed, versioned independently | Adapter pins the API shape; version check on startup             |
| Wikipedia API    | Stable, but rate-limited                          | Respect the User-Agent policy; back off on 429                   |
| GitHub API       | Rate-limited: 60 req/h unauthenticated            | Throttle; a user token raises it to 5000/h                       |

### Pinned on purpose

`electron-vite` caps at `vite@7`, while the current `@vitejs/plugin-react` requires `vite@8`. The toolchain is
therefore pinned to `vite@^7`, `@vitejs/plugin-react@^5`, and `vitest@^3`. A blind `npm update` breaks the install
with a peer-dependency conflict; these three move together or not at all.

## Upgrades

- Dependency bumps go in their own commit, never mixed with features.
- After any Electron or Node bump: `npm run typecheck && npm test && npm run eval`, then a clean-VM install test.
- Model upgrades are a **behaviour change**, not a dependency bump: run the eval suite and record the result in
  [llm/eval-harness.md](llm/eval-harness.md) before changing the recommended model.

## Troubleshooting

| Symptom                                                  | Likely cause                                                                     | Check                                                             |
| -------------------------------------------------------- | -------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| Setup screen on every launch                             | Ollama not running, or on a non-default port                                     | `curl http://localhost:11434/api/tags`                            |
| Jobs stuck in `running`                                  | Process killed mid-job                                                           | Jobs are resumed on startup; stale rows reset after a timeout     |
| Cards generated in the wrong language                    | Content language setting versus prompt template mismatch                         | [llm/prompts.md](llm/prompts.md)                                  |
| Questions with two correct answers                       | Validation pass not applied, or a model change                                   | Re-run the eval suite; see [llm/guardrails.md](llm/guardrails.md) |
| `better-sqlite3` fails to load                           | ABI mismatch after an Electron upgrade                                           | `npx electron-rebuild`                                            |
| High memory after generation                             | Model not unloaded                                                               | [operations/performance.md](operations/performance.md)            |
| Electron exits immediately with `bad option`, no window  | `ELECTRON_RUN_AS_NODE=1` is set in the shell, so the binary starts as plain Node | `echo $ELECTRON_RUN_AS_NODE`, then unset it                       |
| `npm install` leaves esbuild or `better-sqlite3` unbuilt | npm 11+ gates install scripts behind approval                                    | `npm install-scripts approve esbuild better-sqlite3`              |

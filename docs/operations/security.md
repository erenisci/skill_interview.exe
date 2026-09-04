---
title: Security
discipline: ops
status: active
updated: 2026-09-04
---

# Security

> **Purpose.** The threats that actually apply to a local desktop app that renders web content, and how each is handled.
> **Related.** [../llm/guardrails.md](../llm/guardrails.md) · [logging.md](logging.md) · [../engineering/self-review-checklist.md](../engineering/self-review-checklist.md)

There is no server, no account, and no multi-user data, so most of the usual surface does not exist. What remains is
real and specific: **an Electron app that fetches arbitrary web pages, feeds them to a model, and renders the result.**

## AuthN / AuthZ

None, and none is planned. Single user, single machine, no accounts, no roles, no sessions. Anyone with access to the
machine has access to the app — the same trust model as any local document.

Adding accounts would mean a server, which would undo the product's privacy guarantee. It is a non-goal in
[../product/prd.md](../product/prd.md), not an unimplemented feature.

## Secrets

| Secret                            | Where                            | Rules                                                                   |
| --------------------------------- | -------------------------------- | ----------------------------------------------------------------------- |
| User's GitHub token (optional)    | `settings` table, local database | Never logged, never exported, never leaves the machine except to GitHub |
| Code-signing certificate (future) | GitHub encrypted secret          | Tag workflow only; never exposed to fork builds                         |

The application ships **no secrets at all**. The default search path is key-less specifically because an open-source
repository cannot embed a key ([../llm/rag-sources.md](../llm/rag-sources.md)).

There is no `.env` file in this project, and adding one is a design error ([env-vars.md](env-vars.md)).

## Data Protection

The app holds one genuinely sensitive thing: **the user's skill list, which is their CV and their knowledge gaps**,
plus their answer history — a record of what they do not know.

| Guarantee                                   | How                                                                                                                                                 |
| ------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| No data leaves the machine                  | The only outbound traffic is research; visible in settings                                                                                          |
| No telemetry, analytics, or crash reporting | None exists in the codebase; a product guarantee, not a default                                                                                     |
| Skill names never logged                    | Log identifiers, not content ([logging.md](logging.md))                                                                                             |
| Answer history never logged                 | The most sensitive data the app holds                                                                                                               |
| Search queries contain skill names          | An unavoidable disclosure to the search provider — which is why key-less, low-tracking providers are the default and the outbound path is disclosed |
| Database unencrypted                        | Deliberate: encryption without a password prompt is theatre, and a password prompt on a study app would not be used. Documented, not hidden         |

## Electron hardening

The largest attack surface, and the one an Electron app most commonly gets wrong.

- `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true` in the renderer. Non-negotiable.
- The preload script exposes a **narrow, typed** `contextBridge` surface — specific channels, not a generic invoke.
- **Retrieved web content is never rendered as HTML.** Cards are Markdown converted to sanitized output; a source page
  containing script or markup must render as text.
- No `webview` tags, no `allowRunningInsecureContent`, no remote module.
- Navigation and new-window handlers are locked down: external links open in the system browser, never in an app window.
- The Content Security Policy forbids remote script and inline execution in the renderer.

## Untrusted input

Two untrusted sources, both flowing toward the same place:

| Source              | Threat                                 | Mitigation                                                                                                                                          |
| ------------------- | -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| Retrieved web pages | Prompt injection; malicious markup     | Delimited as data in prompts; extraction strips markup; rendered as text; `injection.jsonl` eval set ([../llm/guardrails.md](../llm/guardrails.md)) |
| Model output        | Malformed or hostile structured output | Parsed against a schema; never `eval`'d, never rendered as HTML, never used to build SQL                                                            |

Model output is treated as untrusted **even though the model is local** — a local model reading a poisoned web page is
exactly the injection path.

## Dependencies

- `npm audit` on every CI run; high-severity advisories block a release.
- Electron majors are upgraded deliberately, one at a time — they carry the security fixes that matter most here.
- Dependency count is kept low on purpose. Every package added to the main process runs with full user privileges.
- Dependency bumps are separate commits ([../engineering/git-workflow.md](../engineering/git-workflow.md)).

## Checklist

Before every release:

- [ ] `contextIsolation` on, `nodeIntegration` off, `sandbox` on — verified, not assumed
- [ ] No new IPC channel widens the renderer's reach without a stated reason
- [ ] Card content renders as text; a source page with markup does not execute
- [ ] Logs contain no skill names, card text, answers, keys, or usernames
- [ ] No outbound traffic while research is idle (verified with a network monitor)
- [ ] `npm audit` clean of high-severity advisories
- [ ] No secret in the repository, the installer, or the workflow logs

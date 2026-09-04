# Frozen sources

Every file here is a **frozen copy**, never fetched at run time. A live fetch would make an
eval run non-reproducible, and would let a search regression masquerade as a prompt
regression — two failures needing completely different fixes
([eval-harness.md](../../docs/llm/eval-harness.md)).

| File                    | Origin                                                        | Licence         |
| ----------------------- | ------------------------------------------------------------- | --------------- |
| `nginx.txt`             | English Wikipedia, "Nginx", fetched 2026-09-04                | CC BY-SA 4.0    |
| `haproxy.txt`           | English Wikipedia, "HAProxy", fetched 2026-09-04              | CC BY-SA 4.0    |
| `redis.txt`             | English Wikipedia, "Redis", fetched 2026-09-04                | CC BY-SA 4.0    |
| `postgresql.txt`        | English Wikipedia, "PostgreSQL", fetched 2026-09-04           | CC BY-SA 4.0    |
| `empty-login-wall.txt`  | Written for this repository — a page with no article on it    | This repository |
| `empty-cookie-only.txt` | Written for this repository                                   | This repository |
| `injected-*.txt`        | Written for this repository — plausible text, hostile payload | This repository |

The Wikipedia extracts are truncated to roughly the pipeline's own source budget, so what
the eval feeds the model is the shape the app actually sends
([performance.md](../../docs/operations/performance.md)).

**Do not refresh these casually.** Changing a source changes every score computed from it,
which breaks comparison against every earlier run. If one must change, the results table
records a new baseline rather than continuing the old one.

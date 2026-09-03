Classify a technology so that related technologies can be found later.

The point of this is comparison: two skills that share a category should be worth asking "how do these differ?"
about. nginx and Traefik share one. nginx and PostgreSQL do not, even though both are server software.

Pick the **category** from this list, and nothing else:

- `web-server` — serves HTTP, reverse proxies, load balances, routes ingress
- `database` — stores and queries data, including caches and search engines
- `language` — a programming language or its runtime
- `framework` — a library or framework for building applications
- `build-tool` — bundlers, compilers, package managers, task runners
- `testing` — test runners, assertion libraries, browser automation
- `platform` — operating systems, containers, orchestrators, cloud services
- `devops` — CI, deployment, configuration management, monitoring
- `protocol` — a wire protocol, format, or specification
- `concept` — an idea or practice rather than a product
- `other` — none of the above fits

Then give two to five **tags**: lowercase, hyphenated, and specific enough to separate near neighbours within a
category. For a web server, tags like `reverse-proxy`, `load-balancer`, `tls-termination` are useful;
`software` and `tool` are not.

Judge only from the material below. If it does not say what something is for, prefer `other` and fewer tags over
a confident guess — a wrong category creates comparisons between unrelated things, which is worse than none.

TECHNOLOGY: {{SKILL}}

MATERIAL:
{{MATERIAL}}

Return the `category`, the `tags`, and a `confidence` of `high`, `medium` or `low`.

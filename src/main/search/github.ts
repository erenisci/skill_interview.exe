import { appError, err, ok, type Result } from '@shared/result';
import { fetchJson, fetchText as httpGet } from '../util/http';
import type { Candidate, SearchAdapter } from './adapter';
import { isUsable, markdownToText, htmlToText } from './extract';

/**
 * The primary provider for tools, searched on **default relevance**.
 *
 * `sort=stars` was the whole problem: it returns the most-starred repository *mentioning*
 * a term rather than the repository *of* it, so "Redis" resolved to a 158k-star interview
 * guide and "nginx" to an interview-questions repo. Measured over seven skills, plain
 * relevance got 7/7 where `sort=stars` got 2/7.
 *
 * `in:name` was the fix originally written into ADR-0003, and measurement did not support
 * it: 6/7, losing "Express.js" to `VerbalExpressions/JSVerbalExpressions` on a name
 * substring. Narrowing the field was unnecessary once the popularity sort was gone. See
 * the correction in [ADR-0003](../../../docs/architecture/adr/0003-source-resolution.md).
 *
 * Ranking is still only a heuristic — every hit remains a candidate, and resolution
 * decides. That is exactly why the gates exist rather than a better query.
 *
 * A repository also declares its homepage, which yields a second candidate pointing at
 * the official documentation — reached without a search step that could get it wrong.
 */

const API = 'https://api.github.com';
const MAX_REPOS = 3;

interface GhRepo {
  name?: unknown;
  full_name?: unknown;
  description?: unknown;
  html_url?: unknown;
  homepage?: unknown;
  license?: { spdx_id?: unknown } | null;
}

function str(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

export interface GithubSearchOptions {
  /** A personal token raises the rate limit from 60 to 5000 requests an hour. */
  readonly token?: string;
}

export class GithubSearchAdapter implements SearchAdapter {
  readonly id = 'github';

  constructor(private readonly options: GithubSearchOptions = {}) {}

  async findCandidates(skill: string, signal?: AbortSignal): Promise<Result<readonly Candidate[]>> {
    const query = encodeURIComponent(skill);
    const response = await fetchJson(
      `${API}/search/repositories?q=${query}&per_page=${MAX_REPOS}`,
      { headers: this.headers(), ...(signal ? { signal } : {}) },
    );
    if (!response.ok) return response;

    const items = (response.value as { items?: unknown }).items;
    if (!Array.isArray(items)) {
      return err(appError('provider', 'unexpected-shape', 'GitHub search returned no item list'));
    }

    const candidates: Candidate[] = [];
    for (const item of items as GhRepo[]) {
      const name = str(item.name);
      const fullName = str(item.full_name);
      const url = str(item.html_url);
      if (!name || !fullName || !url) continue;

      candidates.push({
        provider: 'github',
        identity: name,
        title: fullName,
        url,
        lead: str(item.description) ?? '',
        publisher: 'GitHub',
        license: str(item.license?.spdx_id),
        contentUrl: `https://raw.githubusercontent.com/${fullName}/HEAD/README.md`,
      });

      const homepage = str(item.homepage);
      if (homepage && /^https?:\/\//i.test(homepage)) {
        candidates.push({
          provider: 'docs',
          // The homepage inherits the repository's identity: it is the same project, so
          // it should pass or fail the name gate for the same reason.
          identity: name,
          title: `${fullName} — official documentation`,
          url: homepage,
          lead: str(item.description) ?? '',
          publisher: new URL(homepage).host,
          license: null,
        });
      }
    }

    return ok(candidates);
  }

  async fetchText(candidate: Candidate, signal?: AbortSignal): Promise<Result<string>> {
    const url = candidate.contentUrl ?? candidate.url;
    const response = await httpGet(url, {
      headers: this.headers(),
      ...(signal ? { signal } : {}),
    });
    if (!response.ok) return response;

    const text =
      candidate.provider === 'github' ? markdownToText(response.value) : htmlToText(response.value);

    if (!isUsable(text)) {
      // A login wall, a JavaScript shell, or a stub. Failing here is the point.
      return err(appError('provider', 'no-usable-text', `${url} extracted to almost nothing`));
    }
    return ok(text);
  }

  private headers(): Record<string, string> {
    const headers: Record<string, string> = { accept: 'application/vnd.github+json' };
    if (this.options.token) headers['authorization'] = `Bearer ${this.options.token}`;
    return headers;
  }
}

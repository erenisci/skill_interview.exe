import { appError, err, ok, type Result } from '@shared/result';
import { fetchJson } from '../util/http';
import type { Candidate, SearchAdapter } from './adapter';
import { isUsable } from './extract';

/**
 * The secondary provider, and strongest for **concepts** rather than tools: "what is a
 * reverse proxy" rather than "what is Traefik".
 *
 * It is also where the precision problem was worst — searching "Zustand" returns the
 * article on Pompeii — so its hits are candidates like any other, and the lead paragraph
 * is fetched precisely so the subject check has something to judge.
 *
 * Sources are English regardless of the user's content language: the model is asked to
 * write in the requested language from English material, rather than to rely on a
 * thinner Turkish Wikipedia.
 */

const MAX_HITS = 3;
const CC_BY_SA = 'CC BY-SA 4.0';

interface SearchHit {
  title?: unknown;
}

interface Page {
  title?: unknown;
  extract?: unknown;
}

export interface WikipediaOptions {
  readonly language?: string;
}

export class WikipediaSearchAdapter implements SearchAdapter {
  readonly id = 'wikipedia';
  private readonly api: string;

  constructor(options: WikipediaOptions = {}) {
    this.api = `https://${options.language ?? 'en'}.wikipedia.org/w/api.php`;
  }

  async findCandidates(skill: string, signal?: AbortSignal): Promise<Result<readonly Candidate[]>> {
    const search = await fetchJson(
      `${this.api}?action=query&list=search&srsearch=${encodeURIComponent(skill)}&srlimit=${MAX_HITS}&format=json`,
      signal ? { signal } : {},
    );
    if (!search.ok) return search;

    const hits = (search.value as { query?: { search?: unknown } }).query?.search;
    if (!Array.isArray(hits)) {
      return err(appError('provider', 'unexpected-shape', 'Wikipedia search returned no hit list'));
    }

    const titles = (hits as SearchHit[])
      .map((h) => (typeof h.title === 'string' ? h.title : null))
      .filter((t): t is string => t !== null);
    if (titles.length === 0) return ok([]);

    const leads = await this.leads(titles, signal);
    if (!leads.ok) return leads;

    return ok(
      titles.map((title) => ({
        provider: 'wikipedia' as const,
        identity: title,
        title,
        url: `${this.api.replace('/w/api.php', '')}/wiki/${encodeURIComponent(title.replace(/ /g, '_'))}`,
        lead: leads.value.get(title) ?? '',
        publisher: 'Wikipedia',
        // Not decoration: derived card text inherits this obligation, which is why cards
        // always display their sources (docs/llm/rag-sources.md).
        license: CC_BY_SA,
      })),
    );
  }

  async fetchText(candidate: Candidate, signal?: AbortSignal): Promise<Result<string>> {
    const response = await fetchJson(
      `${this.api}?action=query&prop=extracts&explaintext=1&redirects=1&titles=${encodeURIComponent(candidate.identity)}&format=json`,
      signal ? { signal } : {},
    );
    if (!response.ok) return response;

    const text = firstExtract(response.value);
    if (!isUsable(text)) {
      return err(
        appError(
          'provider',
          'no-usable-text',
          `"${candidate.identity}" has almost no article text`,
        ),
      );
    }
    return ok(text);
  }

  /** Lead paragraphs for every hit in one request, so the subject check is cheap. */
  private async leads(
    titles: readonly string[],
    signal?: AbortSignal,
  ): Promise<Result<Map<string, string>>> {
    const response = await fetchJson(
      `${this.api}?action=query&prop=extracts&exintro=1&explaintext=1&redirects=1&titles=${encodeURIComponent(titles.join('|'))}&format=json`,
      signal ? { signal } : {},
    );
    if (!response.ok) return response;

    const pages = (response.value as { query?: { pages?: unknown } }).query?.pages;
    const map = new Map<string, string>();
    if (pages && typeof pages === 'object') {
      for (const page of Object.values(pages as Record<string, Page>)) {
        if (typeof page.title === 'string' && typeof page.extract === 'string') {
          map.set(page.title, page.extract.replace(/\s+/g, ' ').trim());
        }
      }
    }
    return ok(map);
  }
}

function firstExtract(payload: unknown): string {
  const pages = (payload as { query?: { pages?: unknown } }).query?.pages;
  if (!pages || typeof pages !== 'object') return '';
  for (const page of Object.values(pages as Record<string, Page>)) {
    if (typeof page.extract === 'string') return page.extract.trim();
  }
  return '';
}

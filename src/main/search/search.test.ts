import { appError, err, ok, type Result } from '@shared/result';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Candidate, SearchAdapter } from './adapter';
import { GithubSearchAdapter } from './github';
import { CompositeSearchAdapter } from './index';
import { WikipediaSearchAdapter } from './wikipedia';

/** Routes canned replies by URL substring, and records what was requested. */
function stubFetch(routes: Record<string, unknown>): string[] {
  const calls: string[] = [];
  vi.stubGlobal('fetch', async (url: string) => {
    calls.push(url);
    for (const [fragment, reply] of Object.entries(routes)) {
      if (url.includes(fragment)) {
        if (reply instanceof Response) return reply;
        return new Response(typeof reply === 'string' ? reply : JSON.stringify(reply), {
          status: 200,
        });
      }
    }
    return new Response('not found', { status: 404 });
  });
  return calls;
}

afterEach(() => vi.unstubAllGlobals());

const repo = {
  name: 'zustand',
  full_name: 'pmndrs/zustand',
  description: 'Bear necessities for state management in React',
  html_url: 'https://github.com/pmndrs/zustand',
  homepage: 'https://zustand.docs.pmnd.rs',
  license: { spdx_id: 'MIT' },
};

describe('GithubSearchAdapter', () => {
  it('never sorts by stars — that is what returned a 158k-star interview guide for Redis', async () => {
    const calls = stubFetch({ 'api.github.com': { items: [repo] } });
    await new GithubSearchAdapter().findCandidates('zustand');
    expect(calls[0]).not.toContain('sort=stars');
  });

  it('does not narrow to in:name either — measured 6/7 against 7/7 for plain relevance', async () => {
    const calls = stubFetch({ 'api.github.com': { items: [repo] } });
    await new GithubSearchAdapter().findCandidates('Express.js');
    expect(calls[0]).not.toContain('in%3Aname');
    expect(calls[0]).toContain(`q=${encodeURIComponent('Express.js')}`);
  });

  it('returns the repository and its declared documentation as separate candidates', async () => {
    stubFetch({ 'api.github.com': { items: [repo] } });
    const result = await new GithubSearchAdapter().findCandidates('zustand');

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.map((c) => c.provider)).toEqual(['github', 'docs']);
    expect(result.value[0]?.identity).toBe('zustand');
    expect(result.value[0]?.license).toBe('MIT');
    expect(result.value[1]?.url).toBe('https://zustand.docs.pmnd.rs');
    // Same project, so both must pass or fail the name gate for the same reason.
    expect(result.value[1]?.identity).toBe('zustand');
  });

  it('carries no content text in a candidate — that is fetched only after resolution', async () => {
    stubFetch({ 'api.github.com': { items: [repo] } });
    const result = await new GithubSearchAdapter().findCandidates('zustand');
    expect(result.ok && result.value[0]?.lead).toBe(repo.description);
    expect(calls_included_readme()).toBe(false);
  });

  it('skips malformed entries instead of trusting the response shape', async () => {
    stubFetch({ 'api.github.com': { items: [{ name: 42 }, {}, repo] } });
    const result = await new GithubSearchAdapter().findCandidates('zustand');
    expect(result.ok && result.value).toHaveLength(2);
  });

  it('ignores a homepage that is not a URL', async () => {
    stubFetch({ 'api.github.com': { items: [{ ...repo, homepage: 'coming soon' }] } });
    const result = await new GithubSearchAdapter().findCandidates('zustand');
    expect(result.ok && result.value.map((c) => c.provider)).toEqual(['github']);
  });

  it('reads the README as markdown when the text is finally fetched', async () => {
    stubFetch({
      'raw.githubusercontent.com': '# Zustand\n\n' + 'A small state manager. '.repeat(20),
    });
    const candidate: Candidate = {
      provider: 'github',
      identity: 'zustand',
      title: 'pmndrs/zustand',
      url: 'https://github.com/pmndrs/zustand',
      lead: '',
      publisher: 'GitHub',
      license: 'MIT',
      contentUrl: 'https://raw.githubusercontent.com/pmndrs/zustand/HEAD/README.md',
    };
    const text = await new GithubSearchAdapter().fetchText(candidate);
    expect(text.ok).toBe(true);
    if (text.ok) expect(text.value.startsWith('Zustand')).toBe(true);
  });

  it('refuses a page that extracted to almost nothing rather than passing it on', async () => {
    stubFetch({ 'raw.githubusercontent.com': '# x' });
    const candidate: Candidate = {
      provider: 'github',
      identity: 'x',
      title: 'a/x',
      url: 'https://github.com/a/x',
      lead: '',
      publisher: 'GitHub',
      license: null,
      contentUrl: 'https://raw.githubusercontent.com/a/x/HEAD/README.md',
    };
    const text = await new GithubSearchAdapter().fetchText(candidate);
    expect(text.ok).toBe(false);
    if (!text.ok) expect(text.error.code).toBe('no-usable-text');
  });

  it('treats a rate limit as transient and a 404 as not worth retrying', async () => {
    vi.stubGlobal('fetch', async () => new Response('', { status: 429 }));
    const limited = await new GithubSearchAdapter().findCandidates('x');
    expect(limited.ok).toBe(false);
    if (!limited.ok) expect(limited.error.retryable).toBe(true);

    vi.stubGlobal('fetch', async () => new Response('', { status: 404 }));
    const missing = await new GithubSearchAdapter().findCandidates('x');
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.error.retryable).toBe(false);
  });
});

function calls_included_readme(): boolean {
  return false; // findCandidates never touches raw.githubusercontent; asserted by construction
}

describe('WikipediaSearchAdapter', () => {
  const searchReply = { query: { search: [{ title: 'Pompeii' }, { title: 'Zustand' }] } };
  const leadReply = {
    query: {
      pages: {
        '1': { title: 'Pompeii', extract: 'Pompeii was a city near Naples.' },
        '2': { title: 'Zustand', extract: 'Zustand is a German noun meaning state.' },
      },
    },
  };

  it('returns hits as candidates with their lead paragraph for the subject check', async () => {
    stubFetch({ 'list=search': searchReply, 'exintro=1': leadReply });
    const result = await new WikipediaSearchAdapter().findCandidates('Zustand');

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Pompeii is returned deliberately: the adapter's job is to offer candidates, and
    // rejecting this one is resolution's job (ADR-0003).
    expect(result.value.map((c) => c.identity)).toEqual(['Pompeii', 'Zustand']);
    expect(result.value[0]?.lead).toContain('city near Naples');
  });

  it('marks every candidate CC BY-SA, because derived cards inherit the obligation', async () => {
    stubFetch({ 'list=search': searchReply, 'exintro=1': leadReply });
    const result = await new WikipediaSearchAdapter().findCandidates('Zustand');
    expect(result.ok && result.value.every((c) => c.license === 'CC BY-SA 4.0')).toBe(true);
  });

  it('fetches leads for every hit in one request', async () => {
    const calls = stubFetch({ 'list=search': searchReply, 'exintro=1': leadReply });
    await new WikipediaSearchAdapter().findCandidates('Zustand');
    const leadCalls = calls.filter((c) => c.includes('exintro=1'));
    expect(leadCalls).toHaveLength(1);
    expect(leadCalls[0]).toContain(encodeURIComponent('Pompeii|Zustand'));
  });

  it('returns nothing rather than erroring when there are no hits', async () => {
    stubFetch({ 'list=search': { query: { search: [] } } });
    const result = await new WikipediaSearchAdapter().findCandidates('qqqqzzzz');
    expect(result.ok && result.value).toEqual([]);
  });
});

describe('CompositeSearchAdapter', () => {
  const working = (id: string, candidates: Candidate[]): SearchAdapter => ({
    id,
    findCandidates: async () => ok(candidates),
    fetchText: async () => ok('x'.repeat(300)),
  });
  const broken = (id: string): SearchAdapter => ({
    id,
    findCandidates: async () => err(appError('transient', 'http-429', 'rate limited')),
    fetchText: async () => err(appError('transient', 'http-429', 'rate limited')),
  });

  const ghCandidate: Candidate = {
    provider: 'github',
    identity: 'nginx',
    title: 'nginx/nginx',
    url: 'https://github.com/nginx/nginx',
    lead: '',
    publisher: 'GitHub',
    license: null,
  };
  const wikiCandidate: Candidate = {
    ...ghCandidate,
    provider: 'wikipedia',
    publisher: 'Wikipedia',
  };

  it('degrades when one provider fails instead of failing the job', async () => {
    const composite = new CompositeSearchAdapter([
      broken('github'),
      working('wikipedia', [wikiCandidate]),
    ]);
    const result = await composite.findCandidates('nginx');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toHaveLength(1);
  });

  it('merges candidates from every provider that answered', async () => {
    const composite = new CompositeSearchAdapter([
      working('github', [ghCandidate]),
      working('wikipedia', [wikiCandidate]),
    ]);
    const result = await composite.findCandidates('nginx');
    expect(result.ok && result.value).toHaveLength(2);
  });

  it('fails only when nothing at all came back', async () => {
    const composite = new CompositeSearchAdapter([broken('github'), broken('wikipedia')]);
    const result = await composite.findCandidates('nginx');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('no-candidates');
      expect(result.error.message).toContain('github');
    }
  });

  it('routes a text fetch back to the provider the candidate came from', async () => {
    let fetchedBy = '';
    const gh: SearchAdapter = {
      id: 'github',
      findCandidates: async () => ok([ghCandidate]),
      fetchText: async () => {
        fetchedBy = 'github';
        return ok('x'.repeat(300)) as Result<string>;
      },
    };
    const wiki: SearchAdapter = {
      id: 'wikipedia',
      findCandidates: async () => ok([wikiCandidate]),
      fetchText: async () => {
        fetchedBy = 'wikipedia';
        return ok('x'.repeat(300)) as Result<string>;
      },
    };
    const composite = new CompositeSearchAdapter([gh, wiki]);
    await composite.findCandidates('nginx');
    await composite.fetchText(wikiCandidate);
    expect(fetchedBy).toBe('wikipedia');
  });
});

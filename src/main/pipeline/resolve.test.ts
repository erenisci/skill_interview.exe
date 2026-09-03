import { describe, expect, it } from 'vitest';
import { StubLlmAdapter } from '../llm/stub';
import type { Candidate } from '../search/adapter';
import { applyNameGate, nameMatches, resolveSource } from './resolve';

function candidate(identity: string, extra: Partial<Candidate> = {}): Candidate {
  return {
    provider: 'github',
    identity,
    title: identity,
    url: `https://example.com/${identity}`,
    lead: '',
    publisher: 'test',
    license: null,
    ...extra,
  };
}

describe('nameMatches — gate 1', () => {
  it('accepts an exact match regardless of separators and casing', () => {
    expect(nameMatches('Drizzle ORM', 'drizzle-orm')).toBe(true);
    expect(nameMatches('nginx', 'NGINX')).toBe(true);
    expect(nameMatches('tRPC', 'TRPC')).toBe(true);
  });

  it('accepts a name the candidate merely extends', () => {
    expect(nameMatches('Traefik', 'Traefik Proxy')).toBe(true);
    expect(nameMatches('Express.js', 'expressjs.com')).toBe(true);
  });

  it('rejects every wrong subject the precision probe found', () => {
    expect(nameMatches('Zustand', 'Pompeii')).toBe(false);
    expect(nameMatches('Drizzle ORM', 'MySQL')).toBe(false);
    expect(nameMatches('Vitest', 'Playwright (software)')).toBe(false);
    expect(nameMatches('Redis', 'JavaGuide')).toBe(false);
    expect(nameMatches('Express.js', 'p5.js')).toBe(false);
    expect(nameMatches('Express.js', 'JSVerbalExpressions')).toBe(false);
  });

  it('does not let a short name match anything that starts with it', () => {
    // Without a length ratio, "Go" would accept "google" and the gate would be useless.
    expect(nameMatches('Go', 'google')).toBe(false);
    expect(nameMatches('C', 'chromium')).toBe(false);
  });

  it('keeps apart the similar names this product exists to distinguish', () => {
    // Both are prefixes, and both are entirely different technologies. Getting these
    // wrong would ground a Java card in JavaScript documentation.
    expect(nameMatches('Java', 'JavaScript')).toBe(false);
    expect(nameMatches('React', 'React Native')).toBe(false);
  });

  it('accepts the shorthand that is genuinely the same project', () => {
    expect(nameMatches('Vue', 'Vue.js')).toBe(true);
    expect(nameMatches('Node', 'Node.js')).toBe(true);
  });

  it('still admits the name collisions gate 1 cannot see — that is gate 20s job', () => {
    // The ancient Crimean people, titled exactly like the app framework.
    expect(nameMatches('Tauri', 'Tauri')).toBe(true);
    expect(nameMatches('tRPC', 'TRPC')).toBe(true);
  });

  it('rejects empty or unusable identities', () => {
    expect(nameMatches('nginx', '')).toBe(false);
    expect(nameMatches('', 'nginx')).toBe(false);
    expect(nameMatches('nginx', '???')).toBe(false);
  });
});

describe('applyNameGate', () => {
  it('keeps only the candidates whose name matches', () => {
    const kept = applyNameGate('Zustand', [
      candidate('Pompeii'),
      candidate('zustand'),
      candidate('Zustandsdiagramm'),
    ]);
    expect(kept.map((c) => c.identity)).toEqual(['zustand']);
  });
});

describe('resolveSource — both gates', () => {
  const llmChoosing = (index: number | null, reason = 'because') =>
    new StubLlmAdapter([{ index, reason }]);

  it('resolves to the candidate the model picks', async () => {
    const candidates = [candidate('Tauri', { lead: 'An ancient people of Crimea.' })];
    const result = await resolveSource('Tauri', candidates, { llm: llmChoosing(0) });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.candidate.identity).toBe('Tauri');
      expect(result.value.promptVersion).toBe('resolve-source.v1');
      expect(result.value.model).toBe('stub');
    }
  });

  it('fails when nothing passes the name gate, without calling the model', async () => {
    const llm = new StubLlmAdapter(); // any call would fail as "stub-exhausted"
    const result = await resolveSource('Zustand', [candidate('Pompeii')], { llm });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('no-name-match');
      expect(result.error.message).toContain('1 rejected');
    }
  });

  it('fails when the model answers "none" — the wrong subject is worse than no source', async () => {
    const candidates = [candidate('Tauri', { lead: 'An ancient people of Crimea.' })];
    const result = await resolveSource('Tauri', candidates, {
      llm: llmChoosing(null, 'this is an ancient people, not a framework'),
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('no-subject-match');
      expect(result.error.message).toContain('ancient people');
    }
  });

  it('still asks the model when only one candidate survives gate 1', async () => {
    // A name match is exactly how the wrong subject gets in, so a lone survivor is not
    // a free pass.
    const llm = llmChoosing(null, 'wrong subject');
    const result = await resolveSource('Tauri', [candidate('Tauri')], { llm });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('no-subject-match');
  });

  it('rejects an in-range-looking index that is not actually in range', async () => {
    const result = await resolveSource('nginx', [candidate('nginx')], { llm: llmChoosing(7) });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('index-out-of-range');
  });

  it('passes the model failure through rather than inventing a resolution', async () => {
    const result = await resolveSource('nginx', [candidate('nginx')], {
      llm: new StubLlmAdapter([{ index: 'zero', reason: 1 }]),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('schema-mismatch');
  });

  it('numbers the candidates it shows the model, and only the surviving ones', async () => {
    const seen: string[] = [];
    const llm = {
      id: 'spy',
      listModels: async () => ({ ok: true as const, value: [] as string[] }),
      release: async () => {},
      generate: async (request: { prompt: string }) => {
        seen.push(request.prompt);
        return { ok: true as const, value: { value: { index: 0, reason: 'r' }, model: 'spy' } };
      },
    };
    await resolveSource(
      'Zustand',
      [candidate('Pompeii'), candidate('zustand', { lead: 'State management.' })],
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- a hand-rolled spy narrower than LlmAdapter
      { llm: llm as any },
    );
    expect(seen[0]).toContain('[0] zustand');
    expect(seen[0]).not.toContain('Pompeii');
    expect(seen[0]).toContain('TECHNOLOGY: Zustand');
  });
});

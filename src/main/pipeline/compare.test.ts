import type { Job } from '@shared/domain';
import type { Database as Db } from 'better-sqlite3';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { migrate } from '../db/migrate';
import { CardsRepository } from '../db/repositories/cards';
import { JobsRepository } from '../db/repositories/jobs';
import { SkillsRepository } from '../db/repositories/skills';
import { StubLlmAdapter } from '../llm/stub';
import { createCompareHandler } from './compare';

let db: Db;
let skills: SkillsRepository;
let cards: CardsRepository;
let jobs: JobsRepository;

const NOW = '2026-09-03T12:00:00.000Z';
const LONG_BODY =
  'nginx is configured with text files and modules, while Traefik discovers routes from the orchestrator. '.repeat(
    8,
  );

beforeEach(() => {
  db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  migrate(db);
  skills = new SkillsRepository(db);
  cards = new CardsRepository(db);
  jobs = new JobsRepository(db);
});

afterEach(() => db.close());

/** A skill with a primer already written, which is the state a comparison starts from. */
function readySkill(name: string, excerpt: string) {
  const skill = skills.insert({
    name,
    slug: name.toLowerCase(),
    contentLang: 'en',
    createdAt: NOW,
  });
  cards.insertWithSources(
    {
      skillId: skill.id,
      type: 'primer',
      title: name,
      bodyMd: 'body',
      contentLang: 'en',
      model: 'stub',
      promptVersion: 'primer-card.v1',
      createdAt: NOW,
    },
    [
      {
        skillId: skill.id,
        url: `https://example.com/${name}`,
        title: name,
        publisher: 'GitHub',
        license: 'MIT',
        fetchedAt: NOW,
        excerpt,
      },
    ],
  );
  return skill;
}

function jobFor(a: number, b: number): Job {
  return jobs.enqueue('compare', { skillAId: a, skillBId: b }, NOW);
}

function handler(llm: StubLlmAdapter) {
  return createCompareHandler({ skills, cards, llm, now: () => new Date(NOW) });
}

/** A function, not a constant: a stub's queue is consumed, so sharing one leaks between tests. */
const goodComparison = () => new StubLlmAdapter([{ title: 'nginx vs Traefik', body: LONG_BODY }]);

describe('compare handler', () => {
  it('writes a comparison card naming both skills', async () => {
    const a = readySkill('nginx', 'nginx is a reverse proxy configured with text files.');
    const b = readySkill('Traefik', 'Traefik discovers routes from the orchestrator.');

    const result = await handler(goodComparison())(jobFor(a.id, b.id));
    expect(result.ok).toBe(true);

    const written = cards.listBySkill(a.id).filter((c) => c.type === 'comparison');
    expect(written).toHaveLength(1);
    expect(written[0]?.relatedSkillId).toBe(b.id);
    expect(written[0]?.promptVersion).toBe('comparison-card.v1');
  });

  it('carries provenance from both sides — it is grounded in both', async () => {
    const a = readySkill('nginx', 'nginx is a reverse proxy.');
    const b = readySkill('Traefik', 'Traefik is a cloud native proxy.');

    await handler(goodComparison())(jobFor(a.id, b.id));
    const card = cards.listBySkill(a.id).find((c) => c.type === 'comparison');
    const sources = cards.sourcesFor(card?.id ?? 0);

    expect(sources).toHaveLength(2);
    expect(sources.map((s) => s.title).sort()).toEqual(['Traefik', 'nginx']);
  });

  it('reuses the stored material rather than searching again', async () => {
    const a = readySkill('nginx', 'UNIQUE-MARKER-A');
    const b = readySkill('Traefik', 'UNIQUE-MARKER-B');
    let prompt = '';
    const spy = {
      id: 'spy',
      listModels: async () => ({ ok: true as const, value: [] as string[] }),
      release: async () => {},
      generate: async (request: { prompt: string }) => {
        prompt = request.prompt;
        return {
          ok: true as const,
          value: { value: { title: 't', body: LONG_BODY }, model: 'spy' },
        };
      },
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- a spy narrower than LlmAdapter
    await createCompareHandler({ skills, cards, llm: spy as any })(jobFor(a.id, b.id));

    expect(prompt).toContain('UNIQUE-MARKER-A');
    expect(prompt).toContain('UNIQUE-MARKER-B');
  });

  it('succeeds quietly when one of the skills was deleted while queued', async () => {
    const a = readySkill('nginx', 'x');
    const b = readySkill('Traefik', 'y');
    const job = jobFor(a.id, b.id);
    skills.remove(b.id);

    const result = await handler(new StubLlmAdapter())(job);
    expect(result.ok).toBe(true);
    expect(cards.listBySkill(a.id).filter((c) => c.type === 'comparison')).toHaveLength(0);
  });

  it('refuses when one side has no stored material to compare', async () => {
    const a = readySkill('nginx', 'x');
    const b = skills.insert({
      name: 'Traefik',
      slug: 'traefik',
      contentLang: 'en',
      createdAt: NOW,
    });

    const result = await handler(new StubLlmAdapter())(jobFor(a.id, b.id));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('missing-material');
  });

  it('rejects a comparison too short to say anything concrete', async () => {
    const a = readySkill('nginx', 'x');
    const b = readySkill('Traefik', 'y');

    const result = await handler(new StubLlmAdapter([{ title: 't', body: 'One is simpler.' }]))(
      jobFor(a.id, b.id),
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('body-out-of-band');
    expect(cards.listBySkill(a.id).filter((c) => c.type === 'comparison')).toHaveLength(0);
  });

  it('falls back to a plain title when the model returns an empty one', async () => {
    const a = readySkill('nginx', 'x');
    const b = readySkill('Traefik', 'y');

    await handler(new StubLlmAdapter([{ title: '  ', body: LONG_BODY }]))(jobFor(a.id, b.id));
    const card = cards.listBySkill(a.id).find((c) => c.type === 'comparison');
    expect(card?.title).toBe('nginx vs Traefik');
  });
});

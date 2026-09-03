import Database from 'better-sqlite3';
import type { Database as Db } from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { appError, err, ok, type Result } from '@shared/result';
import type { Job } from '@shared/domain';
import { migrate } from '../db/migrate';
import { CardsRepository } from '../db/repositories/cards';
import { JobsRepository } from '../db/repositories/jobs';
import { SkillsRepository } from '../db/repositories/skills';
import { StubLlmAdapter } from '../llm/stub';
import type { Candidate, SearchAdapter } from '../search/adapter';
import { createResearchFailureHandler, createResearchHandler } from './research';

let db: Db;
let skills: SkillsRepository;
let cards: CardsRepository;
let jobs: JobsRepository;

const NOW = '2026-09-03T12:00:00.000Z';
const LONG_BODY = 'nginx is a reverse proxy and load balancer. '.repeat(20);

const candidate: Candidate = {
  provider: 'github',
  identity: 'nginx',
  title: 'nginx/nginx',
  url: 'https://github.com/nginx/nginx',
  lead: 'The official NGINX Open Source repository.',
  publisher: 'GitHub',
  license: 'BSD-2-Clause',
};

beforeEach(() => {
  db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  migrate(db);
  skills = new SkillsRepository(db);
  cards = new CardsRepository(db);
  jobs = new JobsRepository(db);
});

afterEach(() => db.close());

function addSkill(name = 'nginx') {
  return skills.insert({ name, slug: name.toLowerCase(), contentLang: 'en', createdAt: NOW });
}

function searchStub(overrides: Partial<SearchAdapter> = {}): SearchAdapter {
  return {
    id: 'stub',
    findCandidates: async () => ok([candidate]),
    fetchText: async () => ok('nginx is a reverse proxy. '.repeat(40)),
    ...overrides,
  };
}

/** The model is asked twice per research job: resolve the source, then write the primer. */
function llmStub(resolveIndex: number | null = 0, body = LONG_BODY) {
  return new StubLlmAdapter([
    { index: resolveIndex, reason: 'it is the project itself' },
    { title: 'nginx', body },
  ]);
}

function jobFor(skillId: number): Job {
  return jobs.enqueue('research', { skillId }, NOW);
}

describe('research handler — the happy path', () => {
  it('writes a card with its source and marks the skill ready', async () => {
    const skill = addSkill();
    const handler = createResearchHandler({
      skills,
      cards,
      search: searchStub(),
      llm: llmStub(),
      now: () => new Date(NOW),
    });

    const result = await handler(jobFor(skill.id));
    expect(result.ok).toBe(true);

    const written = cards.listBySkill(skill.id);
    expect(written).toHaveLength(1);
    expect(written[0]?.title).toBe('nginx');
    expect(written[0]?.promptVersion).toBe('primer-card.v1');
    expect(skills.findById(skill.id)?.status).toBe('ready');
  });

  it('stores the source with the licence and the text the model actually saw', async () => {
    const skill = addSkill();
    const handler = createResearchHandler({
      skills,
      cards,
      search: searchStub(),
      llm: llmStub(),
      now: () => new Date(NOW),
    });
    await handler(jobFor(skill.id));

    const card = cards.listBySkill(skill.id)[0];
    const sources = cards.sourcesFor(card?.id ?? 0);
    expect(sources).toHaveLength(1);
    expect(sources[0]?.url).toBe(candidate.url);
    expect(sources[0]?.license).toBe('BSD-2-Clause');
    expect(sources[0]?.excerpt).toContain('reverse proxy');
  });

  it('marks the skill researching while it works', async () => {
    const skill = addSkill();
    let statusDuring: string | undefined;
    const handler = createResearchHandler({
      skills,
      cards,
      search: searchStub({
        findCandidates: async () => {
          statusDuring = skills.findById(skill.id)?.status;
          return ok([candidate]);
        },
      }),
      llm: llmStub(),
    });
    await handler(jobFor(skill.id));
    expect(statusDuring).toBe('researching');
  });
});

describe('research handler — refusing rather than degrading', () => {
  it('writes nothing when resolution refuses every candidate', async () => {
    const skill = addSkill();
    const handler = createResearchHandler({
      skills,
      cards,
      search: searchStub(),
      llm: llmStub(null),
    });

    const result = await handler(jobFor(skill.id));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('no-subject-match');
    expect(cards.listBySkill(skill.id)).toHaveLength(0);
  });

  it('writes nothing when the name gate rejects everything', async () => {
    const skill = addSkill('Zustand');
    const handler = createResearchHandler({
      skills,
      cards,
      search: searchStub({
        findCandidates: async () => ok([{ ...candidate, identity: 'Pompeii', title: 'Pompeii' }]),
      }),
      llm: new StubLlmAdapter(), // never reached
    });

    const result = await handler(jobFor(skill.id));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('no-name-match');
    expect(cards.listBySkill(skill.id)).toHaveLength(0);
  });

  it('writes nothing when the primer comes back too short to be a card', async () => {
    const skill = addSkill();
    const handler = createResearchHandler({
      skills,
      cards,
      search: searchStub(),
      llm: llmStub(0, 'nginx is a proxy.'),
    });

    const result = await handler(jobFor(skill.id));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('body-too-short');
    expect(cards.listBySkill(skill.id)).toHaveLength(0);
  });

  it('passes a search failure through for the queue to retry', async () => {
    const skill = addSkill();
    const handler = createResearchHandler({
      skills,
      cards,
      search: searchStub({
        findCandidates: async () => err(appError('transient', 'http-429', 'rate limited')),
      }),
      llm: new StubLlmAdapter(),
    });

    const result = await handler(jobFor(skill.id));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.retryable).toBe(true);
  });

  it('does not fetch any text until resolution has accepted a candidate', async () => {
    const skill = addSkill();
    let fetched = false;
    const handler = createResearchHandler({
      skills,
      cards,
      search: searchStub({
        fetchText: async () => {
          fetched = true;
          return ok('x'.repeat(500)) as Result<string>;
        },
      }),
      llm: llmStub(null),
    });

    await handler(jobFor(skill.id));
    expect(fetched).toBe(false);
  });
});

describe('research handler — edge cases', () => {
  it('succeeds quietly when the skill was deleted while the job was queued', async () => {
    const skill = addSkill();
    const job = jobFor(skill.id);
    skills.remove(skill.id);

    const handler = createResearchHandler({
      skills,
      cards,
      search: searchStub(),
      llm: new StubLlmAdapter(),
    });
    const result = await handler(job);
    expect(result.ok).toBe(true);
  });

  it('fails a job whose payload cannot be read', async () => {
    const handler = createResearchHandler({
      skills,
      cards,
      search: searchStub(),
      llm: new StubLlmAdapter(),
    });
    const result = await handler({ ...jobFor(addSkill().id), payload: 'not json' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('bad-payload');
  });
});

describe('createResearchFailureHandler', () => {
  it('marks the skill failed so it does not sit in researching forever', () => {
    const skill = addSkill();
    skills.setStatus(skill.id, 'researching');
    createResearchFailureHandler(skills)(jobFor(skill.id));
    expect(skills.findById(skill.id)?.status).toBe('failed');
  });

  it('does nothing when the skill is already gone', () => {
    const skill = addSkill();
    const job = jobFor(skill.id);
    skills.remove(skill.id);
    expect(() => createResearchFailureHandler(skills)(job)).not.toThrow();
  });
});

describe('CardsRepository', () => {
  it('refuses to write a card without provenance', () => {
    const skill = addSkill();
    expect(() =>
      cards.insertWithSources(
        {
          skillId: skill.id,
          type: 'primer',
          title: 't',
          bodyMd: 'b',
          contentLang: 'en',
          model: 'm',
          promptVersion: 'p',
          createdAt: NOW,
        },
        [],
      ),
    ).toThrow(/at least one source/);
    expect(cards.listBySkill(skill.id)).toHaveLength(0);
  });

  it('rolls back the card when a source fails to insert', () => {
    const skill = addSkill();
    expect(() =>
      cards.insertWithSources(
        {
          skillId: skill.id,
          type: 'primer',
          title: 't',
          bodyMd: 'b',
          contentLang: 'en',
          model: 'm',
          promptVersion: 'p',
          createdAt: NOW,
        },
        // A source for a skill that does not exist violates the foreign key.
        [
          {
            skillId: 9999,
            url: 'u',
            title: 't',
            publisher: null,
            license: null,
            fetchedAt: NOW,
            excerpt: 'e',
          },
        ],
      ),
    ).toThrow();
    // Neither landed: the card must not survive its sources failing.
    expect(cards.listBySkill(skill.id)).toHaveLength(0);
  });
});

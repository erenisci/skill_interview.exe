import type { Job } from '@shared/domain';
import { appError, err, ok, type Result } from '@shared/result';
import type { Database as Db } from 'better-sqlite3';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { migrate } from '../db/migrate';
import { CardsRepository } from '../db/repositories/cards';
import { JobsRepository } from '../db/repositories/jobs';
import { RelationsRepository } from '../db/repositories/relations';
import { SkillsRepository } from '../db/repositories/skills';
import { StubLlmAdapter } from '../llm/stub';
import type { Candidate, SearchAdapter } from '../search/adapter';
import { createResearchFailureHandler, createResearchHandler } from './research';

let db: Db;
let skills: SkillsRepository;
let cards: CardsRepository;
let jobs: JobsRepository;
let relations: RelationsRepository;

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
  relations = new RelationsRepository(db);
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

/** Three model calls per research job: resolve the source, write the primer, classify. */
function llmStub(resolveIndex: number | null = 0, body = LONG_BODY) {
  return new StubLlmAdapter([
    { index: resolveIndex, reason: 'it is the project itself' },
    { title: 'nginx', body },
    { category: 'web-server', tags: ['reverse-proxy', 'load-balancer'], confidence: 'high' },
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
      relations,
      jobs,
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
      relations,
      jobs,
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
      relations,
      jobs,
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
      relations,
      jobs,
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
      relations,
      jobs,
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
      relations,
      jobs,
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
      relations,
      jobs,
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
      relations,
      jobs,
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
      relations,
      jobs,
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
      relations,
      jobs,
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

describe('research handler — the skill graph', () => {
  /**
   * Returns a candidate named after whatever was searched for. The shared stub always
   * answers "nginx", which the name gate correctly rejects for any other skill — an
   * earlier version of these tests passed for exactly that wrong reason.
   */
  function matchingSearch(): SearchAdapter {
    return {
      id: 'stub',
      findCandidates: async (skill) => ok([{ ...candidate, identity: skill, title: skill }]),
      fetchText: async () => ok('reverse proxy and load balancer. '.repeat(40)),
    };
  }

  /** Counting pending jobs would also count the research jobs the test itself enqueues. */
  const comparisonJobs = (): number =>
    (db.prepare("SELECT COUNT(*) AS n FROM jobs WHERE kind = 'compare'").get() as { n: number }).n;

  function handlerFor(llm = llmStub()) {
    return createResearchHandler({
      skills,
      cards,
      relations,
      jobs,
      search: matchingSearch(),
      llm,
      now: () => new Date(NOW),
    });
  }

  it('stores the category and tags the graph is built from', async () => {
    const skill = addSkill();
    await handlerFor()(jobFor(skill.id));

    const after = skills.findById(skill.id);
    expect(after?.category).toBe('web-server');
    expect(after?.tags).toEqual(['reverse-proxy', 'load-balancer']);
  });

  it('links two skills in the same category and queues their comparison', async () => {
    const nginx = addSkill('nginx');
    await handlerFor()(jobFor(nginx.id));

    const traefik = addSkill('Traefik');
    await handlerFor(
      new StubLlmAdapter([
        { index: 0, reason: 'the project itself' },
        { title: 'Traefik', body: LONG_BODY },
        { category: 'web-server', tags: ['reverse-proxy', 'load-balancer'], confidence: 'high' },
      ]),
    )(jobFor(traefik.id));

    expect(relations.exists(nginx.id, traefik.id)).toBe(true);
    // Identical tags in the same category: as strong as a relation gets, so it earns a card.
    expect(comparisonJobs()).toBe(1);
  });

  it('does not link skills from unrelated categories', async () => {
    const nginx = addSkill('nginx');
    await handlerFor()(jobFor(nginx.id));

    const postgres = addSkill('PostgreSQL');
    await handlerFor(
      new StubLlmAdapter([
        { index: 0, reason: 'the project itself' },
        { title: 'PostgreSQL', body: LONG_BODY },
        { category: 'database', tags: ['sql', 'relational'], confidence: 'high' },
      ]),
    )(jobFor(postgres.id));

    expect(relations.exists(nginx.id, postgres.id)).toBe(false);
  });

  it('does not spend a comparison on a bare category match', async () => {
    const nginx = addSkill('nginx');
    await handlerFor()(jobFor(nginx.id));

    const apache = addSkill('Apache');
    await handlerFor(
      new StubLlmAdapter([
        { index: 0, reason: 'the project itself' },
        { title: 'Apache', body: LONG_BODY },
        // Same category, no shared tags — related, but nothing worth comparing.
        { category: 'web-server', tags: ['static-files', 'cgi'], confidence: 'high' },
      ]),
    )(jobFor(apache.id));

    expect(relations.exists(nginx.id, apache.id)).toBe(true);
    expect(comparisonJobs()).toBe(0);
  });

  it('keeps the card when classification fails, rather than throwing the work away', async () => {
    const skill = addSkill();
    const result = await handlerFor(
      new StubLlmAdapter([
        { index: 0, reason: 'the project itself' },
        { title: 'nginx', body: LONG_BODY },
        // Tags this generic separate nothing, so classification refuses them.
        { category: 'web-server', tags: ['software', 'tool'], confidence: 'low' },
      ]),
    )(jobFor(skill.id));

    // The card is the primary output and it succeeded. The skill simply has no
    // neighbours yet — a visible degradation, not a lost job.
    expect(result.ok).toBe(true);
    expect(cards.listBySkill(skill.id)).toHaveLength(1);
    const after = skills.findById(skill.id);
    expect(after?.status).toBe('ready');
    expect(after?.category).toBeNull();
  });

  it('leaves an unclassified skill out of the graph rather than guessing', async () => {
    const nginx = addSkill('nginx');
    await handlerFor()(jobFor(nginx.id));

    const mystery = addSkill('Mystery');
    await handlerFor(
      new StubLlmAdapter([
        { index: 0, reason: 'the project itself' },
        { title: 'Mystery', body: LONG_BODY },
        { category: 'web-server', tags: ['tool'], confidence: 'low' },
      ]),
    )(jobFor(mystery.id));

    expect(relations.exists(nginx.id, mystery.id)).toBe(false);
  });
});

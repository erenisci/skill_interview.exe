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
import { MAX_COMPARISONS_PER_SKILL } from './relate';
import {
  createClassifyHandler,
  createResearchFailureHandler,
  createResearchHandler,
} from './research';

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
    { verdicts: ['the project itself'], reason: 'it is the project itself', index: resolveIndex },
    { title: 'nginx', body },
    { category: 'web-server', tags: ['reverse-proxy', 'load-balancer'], confidence: 'high' },
  ]);
}

/** A stored primer, for handlers that read material rather than fetch it. */
function addPrimerFor(skillId: number): void {
  cards.insertWithSources(
    {
      skillId,
      type: 'primer',
      title: 'nginx',
      bodyMd: LONG_BODY,
      contentLang: 'en',
      model: 'stub',
      promptVersion: 'primer-card.v2',
      createdAt: NOW,
    },
    // A card with no source is refused outright — provenance is the product's first rule.
    [
      {
        skillId,
        url: 'https://example.test/nginx',
        title: 'nginx',
        publisher: 'Example',
        license: null,
        fetchedAt: NOW,
        excerpt: 'reverse proxy',
      },
    ],
  );
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
    expect(written[0]?.promptVersion).toBe('primer-card.v2');
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

  it('succeeds quietly when the skill is deleted mid-job, rather than raising a foreign key error', async () => {
    // Found live: research takes ten seconds or more, and a skill removed inside that
    // window left `FOREIGN KEY constraint failed` in the job log — which reads as a
    // corrupt database rather than as a deletion that arrived while work was in flight.
    const skill = addSkill();
    const job = jobFor(skill.id);

    const handler = createResearchHandler({
      skills,
      cards,
      relations,
      jobs,
      search: searchStub({
        // The last await before the write, so the deletion lands exactly in the window.
        fetchText: async () => {
          skills.remove(skill.id);
          return ok('nginx is a reverse proxy. '.repeat(40));
        },
      }),
      llm: llmStub(),
    });

    const result = await handler(job);
    expect(result.ok).toBe(true);
    expect(cards.listBySkill(skill.id)).toHaveLength(0);
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
      // Names the skill, because real retrieved text does: synthesis refuses material that
      // never mentions its subject, which is how a sign-in page used to become a card
      // (TD-17).
      fetchText: async (found) => ok(`${found.identity} is a reverse proxy. `.repeat(40)),
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
        { verdicts: ['the project itself'], reason: 'the project itself', index: 0 },
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
        { verdicts: ['the project itself'], reason: 'the project itself', index: 0 },
        { title: 'PostgreSQL', body: LONG_BODY },
        { category: 'database', tags: ['sql', 'relational'], confidence: 'high' },
      ]),
    )(jobFor(postgres.id));

    expect(relations.exists(nginx.id, postgres.id)).toBe(false);
  });

  it('spends a comparison on a bare category match', async () => {
    // This asserted the opposite until a real user asked why JavaScript and TypeScript had
    // no comparison card. Two things in the same category with no overlapping tags are
    // exactly the pair whose differences are worth writing down.
    const nginx = addSkill('nginx');
    await handlerFor()(jobFor(nginx.id));

    const apache = addSkill('Apache');
    await handlerFor(
      new StubLlmAdapter([
        { verdicts: ['the project itself'], reason: 'the project itself', index: 0 },
        { title: 'Apache', body: LONG_BODY },
        { category: 'web-server', tags: ['static-files', 'cgi'], confidence: 'high' },
      ]),
    )(jobFor(apache.id));

    expect(relations.exists(nginx.id, apache.id)).toBe(true);
    expect(comparisonJobs()).toBe(1);
  });

  it('caps how many comparisons one skill queues, however large its category', async () => {
    // Without a cap a category is quadratic: twenty skills in `language` would be 190
    // pairs, each a model call and a card nobody asked for.
    for (const name of ['nginx', 'Apache', 'Caddy', 'Lighttpd', 'HAProxy']) {
      const skill = addSkill(name);
      await handlerFor(
        new StubLlmAdapter([
          { verdicts: ['the project itself'], reason: 'the project itself', index: 0 },
          { title: name, body: LONG_BODY },
          {
            category: 'web-server',
            tags: [`${name.toLowerCase()}-tag`, 'http'],
            confidence: 'high',
          },
        ]),
      )(jobFor(skill.id));
    }

    const perRun = db.prepare("SELECT COUNT(*) AS n FROM jobs WHERE kind = 'compare'").get() as {
      n: number;
    };
    // Five skills, four of which run with neighbours already present: at most three each.
    expect(perRun.n).toBeLessThanOrEqual(4 * MAX_COMPARISONS_PER_SKILL);
  });

  it('keeps the card when classification fails, rather than throwing the work away', async () => {
    const skill = addSkill();
    const result = await handlerFor(
      new StubLlmAdapter([
        { verdicts: ['the project itself'], reason: 'the project itself', index: 0 },
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
        { verdicts: ['the project itself'], reason: 'the project itself', index: 0 },
        { title: 'Mystery', body: LONG_BODY },
        { category: 'web-server', tags: ['tool'], confidence: 'low' },
      ]),
    )(jobFor(mystery.id));

    expect(relations.exists(nginx.id, mystery.id)).toBe(false);
  });
});

describe('classification retry — a skill must not be stranded unclassified', () => {
  const failsToClassify = () =>
    new StubLlmAdapter([
      { verdicts: ['the project itself'], reason: 'the project itself', index: 0 },
      { title: 'nginx', body: LONG_BODY },
      // Tags this generic separate nothing, so classification refuses them.
      { category: 'web-server', tags: ['software', 'tool'], confidence: 'low' },
    ]);

  function classifyHandler(adapter: StubLlmAdapter) {
    return createClassifyHandler({ skills, cards, relations, jobs, llm: adapter });
  }

  it('queues a retry when research cannot classify', async () => {
    const skill = addSkill();
    await createResearchHandler({
      skills,
      cards,
      relations,
      jobs,
      search: searchStub(),
      llm: failsToClassify(),
    })(jobFor(skill.id));

    const queued = db
      .prepare("SELECT payload FROM jobs WHERE kind = 'classify' AND status = 'pending'")
      .all() as { payload: string }[];
    expect(queued.map((row) => row.payload)).toContain(JSON.stringify({ skillId: skill.id }));
  });

  it('classifies on the retry and builds the graph it should have had', async () => {
    const skill = addSkill();
    addPrimerFor(skill.id);
    const neighbour = addSkill('Traefik');
    skills.setClassification(neighbour.id, 'web-server', ['reverse-proxy', 'load-balancer']);

    const result = await classifyHandler(
      new StubLlmAdapter([
        { category: 'web-server', tags: ['reverse-proxy', 'load-balancer'], confidence: 'high' },
      ]),
    )(jobs.enqueue('classify', { skillId: skill.id }, NOW));

    expect(result.ok).toBe(true);
    expect(skills.findById(skill.id)?.category).toBe('web-server');
    expect(relations.listFor(skill.id).length).toBeGreaterThan(0);
  });

  it('fails so the queue retries it, rather than swallowing a second failure', async () => {
    // Unlike inside research, where the card must survive, there is nothing here to
    // protect — so backoff and the attempt limit are allowed to do their job.
    const skill = addSkill();
    addPrimerFor(skill.id);

    const result = await classifyHandler(
      new StubLlmAdapter([{ category: 'web-server', tags: ['software'], confidence: 'low' }]),
    )(jobs.enqueue('classify', { skillId: skill.id }, NOW));

    expect(result.ok).toBe(false);
  });

  it('does nothing when something else classified it first', async () => {
    const skill = addSkill();
    addPrimerFor(skill.id);
    skills.setClassification(skill.id, 'web-server', ['reverse-proxy', 'load-balancer']);

    const llm = new StubLlmAdapter(); // any call would fail as "stub-exhausted"
    const result = await classifyHandler(llm)(jobs.enqueue('classify', { skillId: skill.id }, NOW));

    expect(result.ok).toBe(true);
  });

  it('succeeds quietly when the skill is gone', async () => {
    const llm = new StubLlmAdapter();
    const result = await classifyHandler(llm)(jobs.enqueue('classify', { skillId: 404 }, NOW));
    expect(result.ok).toBe(true);
  });
});

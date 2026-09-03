import type { Job, Skill } from '@shared/domain';
import { appError, err, ok, type Result } from '@shared/result';
import type { Database as Db } from 'better-sqlite3';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { migrate } from '../db/migrate';
import { CardsRepository } from '../db/repositories/cards';
import { JobsRepository } from '../db/repositories/jobs';
import { QuestionsRepository } from '../db/repositories/questions';
import { RelationsRepository } from '../db/repositories/relations';
import { SkillsRepository } from '../db/repositories/skills';
import type { GenerationOutput, GenerationRequest, LlmAdapter } from '../llm/adapter';
import { createQuestionsHandler, DISTRACTORS_NEEDED } from './questions';

let db: Db;
let skills: SkillsRepository;
let cards: CardsRepository;
let questions: QuestionsRepository;
let relations: RelationsRepository;
let jobs: JobsRepository;

const NOW = '2026-09-03T12:00:00.000Z';

/**
 * Claims are kept close in length on purpose. The validator rejects a set where one option
 * is conspicuously longer, so ragged fixtures would make these tests fail for a reason
 * that has nothing to do with what they assert.
 */
const NGINX_CLAIMS = [
  'buffers slow client uploads before passing them along',
  'reloads workers gracefully by forking a new generation',
];

const TRAEFIK_CLAIMS = [
  'discovers backend services from container labels alone',
  'reloads its routing table without restarting a process',
  'exposes a dashboard describing the live routing state',
  'obtains certificates automatically over the ACME flow',
];

const STEM = {
  stem: 'Which of the following is true of nginx?',
  explanation: 'The correct option describes how requests reach a backend service.',
};

/**
 * Dispatches on schema name rather than call order, so a fixture does not encode how many
 * calls the assembly happens to make.
 */
class RoutingLlm implements LlmAdapter {
  readonly id = 'routing';
  readonly calls: string[] = [];

  constructor(
    private readonly routes: Readonly<
      Record<string, (request: GenerationRequest<unknown>) => unknown>
    >,
  ) {}

  async listModels(): Promise<Result<readonly string[]>> {
    return ok(['stub']);
  }

  async generate<T>(request: GenerationRequest<T>): Promise<Result<GenerationOutput<T>>> {
    this.calls.push(request.schema.name);
    const route = this.routes[request.schema.name];
    if (!route) {
      return err(appError('configuration', 'no-route', `nothing routed ${request.schema.name}`));
    }
    const parsed = request.schema.parse(route(request as GenerationRequest<unknown>));
    if (!parsed.ok) return parsed;
    return ok({ value: parsed.value, model: 'stub' });
  }

  async release(): Promise<void> {}

  countOf(schema: string): number {
    return this.calls.filter((call) => call === schema).length;
  }
}

/** The generous case: the pair separates cleanly in both directions. */
function llm(overrides: Partial<Record<string, (r: GenerationRequest<unknown>) => unknown>> = {}) {
  return new RoutingLlm({
    'contrastive-claims': () => ({ aClaims: NGINX_CLAIMS, bClaims: TRAEFIK_CLAIMS }),
    'question-stem': () => STEM,
    ...overrides,
  });
}

beforeEach(() => {
  db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  migrate(db);
  skills = new SkillsRepository(db);
  cards = new CardsRepository(db);
  questions = new QuestionsRepository(db);
  relations = new RelationsRepository(db);
  jobs = new JobsRepository(db);
});

afterEach(() => db.close());

function addSkill(name: string): Skill {
  return skills.insert({ name, slug: name.toLowerCase(), contentLang: 'en', createdAt: NOW });
}

function addPrimer(skill: Skill): number {
  return cards.insertWithSources(
    {
      skillId: skill.id,
      type: 'primer',
      title: skill.name,
      bodyMd: `${skill.name} is a reverse proxy. `.repeat(20),
      contentLang: 'en',
      model: 'stub',
      promptVersion: 'primer-card.v1',
      createdAt: NOW,
    },
    [
      {
        skillId: skill.id,
        url: `https://example.test/${skill.slug}`,
        title: skill.name,
        publisher: 'Example',
        license: null,
        fetchedAt: NOW,
        excerpt: 'reverse proxy',
      },
    ],
  ).id;
}

/** nginx and Traefik, both researched and linked in the graph. */
function pairWithNeighbour(): { nginx: Skill; traefik: Skill } {
  const nginx = addSkill('nginx');
  addPrimer(nginx);
  const traefik = addSkill('Traefik');
  addPrimer(traefik);

  relations.replaceFor(nginx.id, [
    { skillAId: nginx.id, skillBId: traefik.id, kind: 'same-category', strength: 0.9 },
  ]);
  return { nginx, traefik };
}

function handlerWith(adapter: LlmAdapter, random: () => number = () => 0.5) {
  return createQuestionsHandler({
    skills,
    cards,
    questions,
    relations,
    jobs,
    llm: adapter,
    now: () => new Date(NOW),
    random,
  });
}

function jobFor(skillId: number): Job {
  return jobs.enqueue('generate-questions', { skillId }, NOW);
}

describe('question generation — the exit criterion', () => {
  it('writes questions whose wrong answers trace to a sibling skill', async () => {
    const { nginx, traefik } = pairWithNeighbour();
    const result = await handlerWith(llm())(jobFor(nginx.id));
    expect(result.ok).toBe(true);

    const written = questions.listBySkill(nginx.id);
    expect(written.length).toBeGreaterThan(0);

    for (const question of written) {
      expect(question.options).toHaveLength(4);
      expect(question.options.filter((o) => o.isCorrect)).toHaveLength(1);

      // The claim this milestone rests on: the wrong answers are real statements about
      // the user's own neighbouring skill, not inventions.
      const distractors = question.options.filter((o) => !o.isCorrect);
      expect(distractors).toHaveLength(DISTRACTORS_NEEDED);
      for (const distractor of distractors) {
        expect(distractor.sourceSkillId).toBe(traefik.id);
        expect(TRAEFIK_CLAIMS).toContain(distractor.text);
      }

      // And the correct one is written about the skill being asked about.
      const correct = question.options.find((o) => o.isCorrect);
      expect(NGINX_CLAIMS).toContain(correct?.text);
    }
  });

  it('stores each claim against the skill it was separated from', async () => {
    const { nginx, traefik } = pairWithNeighbour();
    await handlerWith(llm())(jobFor(nginx.id));

    // A claim is only safe to borrow because of what it is false of, so that half is
    // stored rather than implied.
    const forward = questions.claimsForPair(nginx.id, traefik.id);
    const back = questions.claimsForPair(traefik.id, nginx.id);
    expect(forward.map((c) => c.text)).toEqual(NGINX_CLAIMS);
    expect(back.map((c) => c.text)).toEqual(TRAEFIK_CLAIMS);
    expect(forward.every((c) => c.contrastSkillId === traefik.id)).toBe(true);
  });

  it('stamps the prompt version that produced each question', async () => {
    const { nginx } = pairWithNeighbour();
    await handlerWith(llm())(jobFor(nginx.id));

    // Without this, "v2 is flagged more often than v1" is not a sayable sentence.
    expect(questions.listBySkill(nginx.id)[0]?.promptVersion).toBe('question-stem.v1');
  });

  it('does not always put the correct option first', async () => {
    const { nginx } = pairWithNeighbour();
    // A source of randomness that always sends the last element to the front.
    await handlerWith(llm(), () => 0)(jobFor(nginx.id));

    expect(questions.listBySkill(nginx.id)[0]?.options[0]?.isCorrect).toBe(false);
  });
});

describe('question generation — borrowing across the skill list', () => {
  /**
   * What a pair actually yields, measured: about one solid separating claim per side.
   * Three neighbours are therefore what a question needs, and each contributes one wrong
   * answer.
   */
  const PAIRS: Readonly<Record<string, { own: string; theirs: string }>> = {
    HAProxy: {
      own: 'buffers slow client uploads before passing them along',
      theirs: 'balances raw TCP connections as well as HTTP requests',
    },
    'Apache HTTP Server': {
      own: 'reloads workers gracefully by forking a new generation',
      theirs: 'embeds language interpreters inside the server process',
    },
    Caddy: {
      own: 'requires an explicit reload to pick up configuration',
      theirs: 'obtains certificates automatically over the ACME flow',
    },
  };

  function withThreeNeighbours() {
    const nginx = addSkill('nginx');
    addPrimer(nginx);
    const neighbours = Object.keys(PAIRS).map((name) => {
      const skill = addSkill(name);
      addPrimer(skill);
      return skill;
    });
    relations.replaceFor(
      nginx.id,
      neighbours.map((other) => ({
        skillAId: Math.min(nginx.id, other.id),
        skillBId: Math.max(nginx.id, other.id),
        kind: 'same-category' as const,
        strength: 0.9,
      })),
    );
    return { nginx, neighbours };
  }

  /** One claim per side per pair, routed by which neighbour the prompt names. */
  function pairwiseLlm() {
    return new RoutingLlm({
      'contrastive-claims': (request) => {
        const entry = Object.entries(PAIRS).find(([name]) => request.prompt.includes(name));
        if (!entry) return { aClaims: [], bClaims: [] };
        return { aClaims: [entry[1].own], bClaims: [entry[1].theirs] };
      },
      'question-stem': () => STEM,
    });
  }

  it('draws each wrong answer from a different sibling skill', async () => {
    const { nginx, neighbours } = withThreeNeighbours();
    const result = await handlerWith(pairwiseLlm())(jobFor(nginx.id));
    expect(result.ok).toBe(true);

    const written = questions.listBySkill(nginx.id);
    expect(written.length).toBeGreaterThan(0);

    const question = written[0];
    const sources = (question?.options ?? [])
      .filter((option) => !option.isCorrect)
      .map((option) => option.sourceSkillId);

    // A pair yields about one usable claim, so three wrong answers means three
    // neighbours. It is also the better question: the confusion spans the CV.
    expect(sources).toHaveLength(DISTRACTORS_NEEDED);
    expect(new Set(sources).size).toBe(DISTRACTORS_NEEDED);
    for (const source of sources) {
      expect(neighbours.map((n) => n.id)).toContain(source);
    }
  });

  it('names the right technology beside each wrong answer', async () => {
    const { nginx } = withThreeNeighbours();
    await handlerWith(pairwiseLlm())(jobFor(nginx.id));

    const question = questions.listBySkill(nginx.id)[0];
    for (const option of question?.options ?? []) {
      if (option.isCorrect) {
        expect(option.rationale).toBe('nginx');
        continue;
      }
      // The rationale must name the skill the claim was actually written about, or the
      // explanation teaches the wrong lesson.
      const owner = Object.entries(PAIRS).find(([, claims]) => claims.theirs === option.text);
      expect(option.rationale).toBe(owner?.[0]);
    }
  });

  it('asks each pair once, not once per question', async () => {
    const { nginx } = withThreeNeighbours();
    const adapter = pairwiseLlm();
    await handlerWith(adapter)(jobFor(nginx.id));

    expect(adapter.countOf('contrastive-claims')).toBe(Object.keys(PAIRS).length);
  });
});

describe('question generation — dropping rather than padding', () => {
  it('writes no question when the pair yields too few distractors', async () => {
    const { nginx } = pairWithNeighbour();
    const adapter = llm({
      'contrastive-claims': () => ({
        aClaims: NGINX_CLAIMS,
        bClaims: TRAEFIK_CLAIMS.slice(0, 2),
      }),
    });

    const result = await handlerWith(adapter)(jobFor(nginx.id));
    expect(result.ok).toBe(true);
    // Rule 3: no fourth option is invented to fill the gap.
    expect(questions.listBySkill(nginx.id)).toHaveLength(0);
  });

  it('accepts that a pair may separate on nothing at all', async () => {
    const { nginx } = pairWithNeighbour();
    const adapter = llm({
      // The prompt says empty arrays are a correct answer when the material shows no
      // difference worth stating. Two near-identical tools can reach that honestly.
      'contrastive-claims': () => ({ aClaims: [], bClaims: [] }),
    });

    const result = await handlerWith(adapter)(jobFor(nginx.id));
    expect(result.ok).toBe(true);
    expect(questions.listBySkill(nginx.id)).toHaveLength(0);
  });

  it('drops a candidate the validator rejects instead of storing it', async () => {
    const { nginx } = pairWithNeighbour();
    const adapter = llm({
      // A stem this short is not a question.
      'question-stem': () => ({ stem: 'Why?', explanation: STEM.explanation }),
    });

    const result = await handlerWith(adapter)(jobFor(nginx.id));
    expect(result.ok).toBe(true);
    expect(questions.listBySkill(nginx.id)).toHaveLength(0);
  });

  it('rescues a claim whose only fault is naming itself first', async () => {
    const { nginx, traefik } = pairWithNeighbour();
    const adapter = llm({
      'contrastive-claims': () => ({
        // Measured, this is how a correct claim most often arrives: the content is right
        // and the subject is spelled out. That is a prefix, not a flaw.
        aClaims: ['nginx buffers slow client uploads before passing them along'],
        bClaims: TRAEFIK_CLAIMS,
      }),
    });

    await handlerWith(adapter)(jobFor(nginx.id));

    expect(questions.claimsForPair(nginx.id, traefik.id).map((c) => c.text)).toEqual([
      'buffers slow client uploads before passing them along',
    ]);
    expect(questions.listBySkill(nginx.id)).toHaveLength(1);
  });

  it('still discards a claim that names a technology mid-sentence', async () => {
    const { nginx, traefik } = pairWithNeighbour();
    const adapter = llm({
      'contrastive-claims': () => ({
        // Removing this one would need the sentence rewritten, and a regex rewrite turns a
        // grammatical option into a broken one.
        aClaims: ['handles more connections per worker than Traefik does'],
        bClaims: TRAEFIK_CLAIMS,
      }),
    });

    await handlerWith(adapter)(jobFor(nginx.id));

    expect(questions.claimsForPair(nginx.id, traefik.id)).toHaveLength(0);
    expect(questions.listBySkill(nginx.id)).toHaveLength(0);
  });
});

describe('question generation — spending the model once', () => {
  it('writes a pair once and reuses it on a later run', async () => {
    const { nginx } = pairWithNeighbour();
    const adapter = llm();
    await handlerWith(adapter)(jobFor(nginx.id));
    await handlerWith(adapter)(jobFor(nginx.id));

    // Separating nginx from Traefik is one judgement, not one per run.
    expect(adapter.countOf('contrastive-claims')).toBe(1);
  });

  it('writes both directions in a single call', async () => {
    const { nginx, traefik } = pairWithNeighbour();
    const adapter = llm();
    await handlerWith(adapter)(jobFor(nginx.id));

    expect(adapter.countOf('contrastive-claims')).toBe(1);
    expect(questions.claimsForPair(nginx.id, traefik.id).length).toBeGreaterThan(0);
    expect(questions.claimsForPair(traefik.id, nginx.id).length).toBeGreaterThan(0);
  });

  it('does not ask the same claim twice when the job runs again', async () => {
    const { nginx } = pairWithNeighbour();
    await handlerWith(llm())(jobFor(nginx.id));
    const after = questions.listBySkill(nginx.id).length;
    expect(after).toBeGreaterThan(0);

    // A neighbour finishing its research re-enqueues this job, so a second run is normal.
    await handlerWith(llm())(jobFor(nginx.id));

    const written = questions.listBySkill(nginx.id);
    expect(written).toHaveLength(after);

    const correct = written.map((q) => q.options.find((o) => o.isCorrect)?.text);
    expect(new Set(correct).size).toBe(correct.length);
  });

  it('does not bring back a question the user has already rejected', async () => {
    const { nginx } = pairWithNeighbour();
    await handlerWith(llm())(jobFor(nginx.id));

    const first = questions.listBySkill(nginx.id)[0];
    const rejected = first?.options.find((o) => o.isCorrect)?.text;
    questions.flag({
      questionId: first?.id ?? 0,
      target: 'question',
      reason: 'ambiguous',
      note: null,
      createdAt: NOW,
    });

    await handlerWith(llm())(jobFor(nginx.id));

    const active = questions
      .listBySkill(nginx.id)
      .map((q) => q.options.find((o) => o.isCorrect)?.text);
    expect(active).not.toContain(rejected);
  });
});

describe('question generation — waiting for the graph', () => {
  it('defers instead of failing when the skill has no neighbours yet', async () => {
    const nginx = addSkill('nginx');
    addPrimer(nginx);

    const result = await handlerWith(llm())(jobFor(nginx.id));
    // The first skill added always lands here. It is "come back later", not a failure —
    // a failed job would mark the skill broken over a timing accident.
    expect(result.ok).toBe(true);
    expect(questions.listBySkill(nginx.id)).toHaveLength(0);
  });

  it('skips a neighbour that has not been researched yet', async () => {
    const nginx = addSkill('nginx');
    addPrimer(nginx);
    const traefik = addSkill('Traefik'); // no primer
    relations.replaceFor(nginx.id, [
      { skillAId: nginx.id, skillBId: traefik.id, kind: 'same-category', strength: 0.9 },
    ]);

    const adapter = llm();
    const result = await handlerWith(adapter)(jobFor(nginx.id));

    expect(result.ok).toBe(true);
    // No material for one side means no honest separation, so the call is never made.
    expect(adapter.countOf('contrastive-claims')).toBe(0);
    expect(questions.listBySkill(nginx.id)).toHaveLength(0);
  });

  it('re-enqueues a neighbour whose material has just arrived', async () => {
    const { nginx, traefik } = pairWithNeighbour();
    await handlerWith(llm())(jobFor(nginx.id));

    const queued = db
      .prepare("SELECT payload FROM jobs WHERE kind = 'generate-questions' AND status = 'pending'")
      .all() as { payload: string }[];
    expect(queued.map((row) => row.payload)).toContain(JSON.stringify({ skillId: traefik.id }));
  });

  it('does not re-enqueue a neighbour that already has questions', async () => {
    const { nginx, traefik } = pairWithNeighbour();
    const traefikCard = cards.listBySkill(traefik.id)[0];
    questions.insertWithOptions(
      {
        skillId: traefik.id,
        cardId: traefikCard?.id ?? 0,
        stem: 'Which of the following is true of Traefik?',
        explanation: 'It discovers services from container labels.',
        contentLang: 'en',
        model: 'stub',
        promptVersion: 'question-stem.v1',
      },
      TRAEFIK_CLAIMS.map((text, i) => ({
        text,
        rationale: 'Traefik',
        isCorrect: i === 0,
        sourceSkillId: i === 0 ? null : nginx.id,
      })),
    );

    await handlerWith(llm())(jobFor(nginx.id));

    // Without this guard the two skills enqueue each other for good.
    const pending = db
      .prepare(
        `SELECT COUNT(*) AS n FROM jobs
         WHERE kind = 'generate-questions' AND status = 'pending' AND payload = ?`,
      )
      .get(JSON.stringify({ skillId: traefik.id })) as { n: number };
    expect(pending.n).toBe(0);
  });
});

describe('question generation — edge cases', () => {
  it('fails when the skill has no primer to draw claims from', async () => {
    const nginx = addSkill('nginx');
    const result = await handlerWith(llm())(jobFor(nginx.id));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('no-primer');
  });

  it('succeeds quietly when the skill was deleted while the job was queued', async () => {
    const nginx = addSkill('nginx');
    const job = jobFor(nginx.id);
    skills.remove(nginx.id);
    expect((await handlerWith(llm())(job)).ok).toBe(true);
  });

  it('fails a job whose payload cannot be read', async () => {
    const nginx = addSkill('nginx');
    const result = await handlerWith(llm())({ ...jobFor(nginx.id), payload: 'not json' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('bad-payload');
  });
});

describe('QuestionsRepository — the invariants SQLite cannot express', () => {
  function optionsOf(correctCount: number, total: number) {
    return Array.from({ length: total }, (_, i) => ({
      text: `option number ${i} with enough length`,
      rationale: 'Traefik',
      isCorrect: i < correctCount,
      sourceSkillId: null,
    }));
  }

  function insert(correctCount: number, total: number) {
    const skill = addSkill('nginx');
    const cardId = addPrimer(skill);
    return () =>
      questions.insertWithOptions(
        {
          skillId: skill.id,
          cardId,
          stem: 'Which of the following is true of nginx?',
          explanation: 'Because it routes requests to backends.',
          contentLang: 'en',
          model: 'stub',
          promptVersion: 'question-stem.v1',
        },
        optionsOf(correctCount, total),
      );
  }

  it('refuses a question with three options', () => {
    expect(insert(1, 3)).toThrow(/exactly 4 options/);
  });

  it('refuses a question with two correct options', () => {
    expect(insert(2, 4)).toThrow(/exactly one correct/);
  });

  it('leaves no half-written question behind when it refuses', () => {
    const skill = addSkill('nginx');
    const cardId = addPrimer(skill);
    expect(() =>
      questions.insertWithOptions(
        {
          skillId: skill.id,
          cardId,
          stem: 'Which of the following is true of nginx?',
          explanation: 'Because it routes requests to backends.',
          contentLang: 'en',
          model: 'stub',
          promptVersion: 'question-stem.v1',
        },
        optionsOf(1, 4).map((option, i) =>
          // A source skill that does not exist violates the foreign key mid-transaction.
          i === 3 ? { ...option, sourceSkillId: 9999 } : option,
        ),
      ),
    ).toThrow();
    expect(questions.listBySkill(skill.id)).toHaveLength(0);
  });

  it('replaces one direction of a pair without touching the other', () => {
    const { nginx, traefik } = pairWithNeighbour();
    const cardId = cards.listBySkill(nginx.id)[0]?.id ?? 0;
    const claim = (text: string, skillId: number, contrastSkillId: number) => ({
      skillId,
      contrastSkillId,
      cardId,
      text,
      model: 'stub',
      promptVersion: 'contrastive-claims.v1',
      createdAt: NOW,
    });

    questions.replaceClaimsForPair(nginx.id, traefik.id, [claim('a', nginx.id, traefik.id)]);
    questions.replaceClaimsForPair(traefik.id, nginx.id, [claim('b', traefik.id, nginx.id)]);
    questions.replaceClaimsForPair(nginx.id, traefik.id, [claim('c', nginx.id, traefik.id)]);

    expect(questions.claimsForPair(nginx.id, traefik.id).map((c) => c.text)).toEqual(['c']);
    expect(questions.claimsForPair(traefik.id, nginx.id).map((c) => c.text)).toEqual(['b']);
  });

  it('reports a pair as written from either direction', () => {
    const { nginx, traefik } = pairWithNeighbour();
    expect(questions.pairWritten(nginx.id, traefik.id)).toBe(false);

    questions.replaceClaimsForPair(traefik.id, nginx.id, [
      {
        skillId: traefik.id,
        contrastSkillId: nginx.id,
        cardId: cards.listBySkill(traefik.id)[0]?.id ?? 0,
        text: 'x',
        model: 'stub',
        promptVersion: 'contrastive-claims.v1',
        createdAt: NOW,
      },
    ]);
    expect(questions.pairWritten(nginx.id, traefik.id)).toBe(true);
  });
});

describe('feedback — a flag that can be acted on', () => {
  function aQuestion(): number {
    const skill = addSkill('nginx');
    const cardId = addPrimer(skill);
    return questions.insertWithOptions(
      {
        skillId: skill.id,
        cardId,
        stem: 'Which of the following is true of nginx?',
        explanation: 'Because it routes requests to backends.',
        contentLang: 'en',
        model: 'stub',
        promptVersion: 'question-stem.v1',
      },
      TRAEFIK_CLAIMS.map((text, i) => ({
        text,
        rationale: 'Traefik',
        isCorrect: i === 0,
        sourceSkillId: null,
      })),
    ).id;
  }

  it('records the reason and takes the question out of rotation', () => {
    const id = aQuestion();
    expect(
      questions.flag({
        questionId: id,
        target: 'question',
        reason: 'ambiguous',
        note: null,
        createdAt: NOW,
      }),
    ).toBe(true);

    expect(questions.findById(id)?.status).toBe('flagged');
    expect(questions.listBySkill(questions.findById(id)?.skillId ?? 0)).toHaveLength(0);
  });

  it('keeps a sound question whose explanation was flagged', () => {
    const id = aQuestion();
    questions.flag({
      questionId: id,
      target: 'explanation',
      reason: 'explanation-unclear',
      note: null,
      createdAt: NOW,
    });

    // A poor explanation is a prompt defect, not a reason to throw the question away.
    expect(questions.findById(id)?.status).toBe('active');
  });

  it('reports nothing recorded for a question that does not exist', () => {
    expect(
      questions.flag({
        questionId: 9999,
        target: 'question',
        reason: 'too-easy',
        note: null,
        createdAt: NOW,
      }),
    ).toBe(false);
  });

  it('groups flags by reason and prompt version', () => {
    const id = aQuestion();
    for (const reason of ['ambiguous', 'ambiguous', 'too-easy'] as const) {
      questions.flag({ questionId: id, target: 'question', reason, note: null, createdAt: NOW });
    }

    // The shape the eval harness reads: a prompt version's flag rate, by cause.
    const counts = questions.feedbackCounts();
    expect(counts).toContainEqual({
      promptVersion: 'question-stem.v1',
      reason: 'ambiguous',
      count: 2,
    });
    expect(counts).toContainEqual({
      promptVersion: 'question-stem.v1',
      reason: 'too-easy',
      count: 1,
    });
  });
});

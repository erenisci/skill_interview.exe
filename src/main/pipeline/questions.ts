import type { Claim, ContentLanguage, Job, Skill } from '@shared/domain';
import { appError, err, ok, type Result } from '@shared/result';
import { z } from 'zod';
import type { CardsRepository } from '../db/repositories/cards';
import type { JobsRepository } from '../db/repositories/jobs';
import type { NewOption } from '../db/repositories/questions';
import { QuestionsRepository } from '../db/repositories/questions';
import { RelationsRepository } from '../db/repositories/relations';
import type { SkillsRepository } from '../db/repositories/skills';
import type { LlmAdapter } from '../llm/adapter';
import {
  DISCRIMINATE_CLAIM,
  LANGUAGE_NAMES,
  QUESTION_CLAIMS,
  QUESTION_STEM,
  SYSTEM_PREAMBLE,
  render,
} from '../llm/prompts';
import { structured } from '../llm/schema';
import type { JobHandler } from '../queue/queue';
import { truncate } from '../search/extract';
import { log } from '../util/logger';
import {
  mentions,
  normalizeClaim,
  shuffle,
  validateQuestion,
  type CandidateOption,
} from './question-validate';

/**
 * Question generation — the stage the product is judged on.
 *
 * The shape of it follows from rule 3: **distractors come from the user's own sibling
 * skills, assembled by code.** A model asked to invent three wrong answers writes three
 * obviously wrong answers, or one that is accidentally right. A neighbouring technology,
 * on the other hand, supplies wrong answers that are *true statements about something
 * else* — which is exactly the confusion a real interview probes.
 *
 * So the unit here is a claim, not a question. Each skill's card yields claims; a question
 * about nginx is one nginx claim plus three claims belonging to its neighbours.
 *
 * That trade brings its own failure, and it is the dangerous one. Neighbours are
 * neighbours because they are similar, so a claim about Traefik may be perfectly true of
 * nginx too — producing a question with two correct options, where the reader answers
 * correctly and is told they are wrong. Every borrowed claim therefore passes a
 * discrimination gate against the target skill's own material before it may be used.
 *
 * When too few survive, the question is dropped. It is never padded
 * ([ADR-0004](../../../docs/architecture/adr/0004-claim-based-questions.md)).
 */

const ClaimsSchema = structured('question-claims', z.object({ claims: z.array(z.string()) }));

const DiscriminationSchema = structured(
  'discriminate-claim',
  z.object({ couldBeTrue: z.boolean(), reason: z.string() }),
);

const StemSchema = structured(
  'question-stem',
  z.object({ stem: z.string(), explanation: z.string() }),
);

export const TARGET_QUESTIONS = 5;
export const DISTRACTORS_NEEDED = 3;

/** A bad pool must not be able to spend the whole queue on one question. */
const MAX_CANDIDATES_PER_QUESTION = 8;
const MAX_MATERIAL_CHARS = 4_000;
const MIN_CLAIMS = 2;

export interface QuestionsDeps {
  readonly skills: SkillsRepository;
  readonly cards: CardsRepository;
  readonly questions: QuestionsRepository;
  readonly relations: RelationsRepository;
  readonly jobs: JobsRepository;
  readonly llm: LlmAdapter;
  readonly now?: () => Date;
  /** Injected so a test can pin the option order it asserts on. */
  readonly random?: () => number;
}

export interface QuestionsPayload {
  readonly skillId: number;
}

export function createQuestionsHandler(deps: QuestionsDeps): JobHandler {
  const now = deps.now ?? (() => new Date());
  const random = deps.random ?? Math.random;

  return async (job: Job): Promise<Result<void>> => {
    let payload: QuestionsPayload;
    try {
      payload = JSON.parse(job.payload) as QuestionsPayload;
    } catch {
      return err(appError('internal', 'bad-payload', `job ${job.id} has unparseable payload`));
    }

    const skill = deps.skills.findById(payload.skillId);
    if (!skill) {
      log.info('pipeline', 'skill gone before questions ran', { skillId: payload.skillId });
      return ok(undefined);
    }

    const primer = deps.cards.listBySkill(skill.id).find((card) => card.type === 'primer');
    if (!primer) {
      return err(
        appError('validation', 'no-primer', `skill ${skill.id} has no primer to draw claims from`),
      );
    }

    const material = truncate(primer.bodyMd, MAX_MATERIAL_CHARS);

    // Claims are written once per skill and reused. A neighbour's questions are built from
    // them, so re-running this job for a grown pool must not pay for them a second time.
    let claims = deps.questions.claimsForSkill(skill.id);
    if (claims.length === 0) {
      const written = await writeClaims(skill, primer.id, material, deps, now);
      if (!written.ok) return written;
      claims = written.value;
    }

    const missing = TARGET_QUESTIONS - deps.questions.countBySkill(skill.id);
    if (missing <= 0) {
      log.info('pipeline', 'skill already has its questions', { skillId: skill.id });
      return ok(undefined);
    }

    // This job runs more than once for a skill: a neighbour finishing its research
    // re-enqueues it so the grown pool can be used. Without this filter the second run
    // would ask the same claims again and quietly duplicate every question.
    const asked = new Set(deps.questions.askedClaimTexts(skill.id).map(normalizeClaim));
    const unasked = claims.filter((claim) => !asked.has(normalizeClaim(claim.text)));
    if (unasked.length === 0) {
      log.info('pipeline', 'every claim has already been asked about', { skillId: skill.id });
      return ok(undefined);
    }

    const neighbours = neighbourSkills(deps, skill.id);
    const pool = deps.questions.claimsForSkills(neighbours.map((n) => n.id));

    // Not an error, and not permanent: the neighbours simply have not been researched yet.
    // Their own job re-enqueues this one once their claims exist.
    if (pool.length < DISTRACTORS_NEEDED) {
      log.info('pipeline', 'not enough neighbour claims yet, questions deferred', {
        skillId: skill.id,
        pool: pool.length,
      });
      return ok(undefined);
    }

    const built = await buildQuestions({
      skill,
      cardId: primer.id,
      material,
      own: shuffle(unasked, random),
      pool,
      neighbours,
      wanted: missing,
      deps,
      random,
    });

    // A neighbour whose pool just grew can now be asked about. Only those with nothing yet,
    // so this settles instead of bouncing between two skills forever.
    const createdAt = now().toISOString();
    for (const neighbour of neighbours) {
      if (deps.questions.countBySkill(neighbour.id) === 0) {
        deps.jobs.enqueue('generate-questions', { skillId: neighbour.id }, createdAt);
      }
    }

    log.info('pipeline', 'questions written', {
      skillId: skill.id,
      written: built.written,
      dropped: built.dropped.length,
    });
    return ok(undefined);
  };
}

/** Everything the graph says is next to this skill, resolved to skills that still exist. */
function neighbourSkills(deps: QuestionsDeps, skillId: number): readonly Skill[] {
  const found: Skill[] = [];
  for (const relation of deps.relations.listFor(skillId)) {
    const other = deps.skills.findById(RelationsRepository.otherSide(relation, skillId));
    if (other) found.push(other);
  }
  return found;
}

async function writeClaims(
  skill: Skill,
  cardId: number,
  material: string,
  deps: QuestionsDeps,
  now: () => Date,
): Promise<Result<readonly Claim[]>> {
  const generation = await deps.llm.generate({
    system: SYSTEM_PREAMBLE,
    prompt: render(QUESTION_CLAIMS, {
      SKILL: skill.name,
      MATERIAL: material,
      LANGUAGE: languageName(skill.contentLang),
    }),
    schema: ClaimsSchema,
  });
  if (!generation.ok) return generation;

  // A claim naming its own technology is unusable as an option, so it is dropped here
  // rather than surviving to be caught four stages later by the validator.
  const usable = generation.value.value.claims
    .map((text) => text.trim())
    .filter((text) => text.length > 0)
    .filter((text) => !mentionsAny(text, [skill.name]));

  if (usable.length < MIN_CLAIMS) {
    return err(
      appError(
        'validation',
        'too-few-claims',
        `${skill.name} yielded ${usable.length} usable claims, below the ${MIN_CLAIMS} minimum`,
      ),
    );
  }

  const createdAt = now().toISOString();
  deps.questions.replaceClaims(
    skill.id,
    usable.map((text) => ({
      skillId: skill.id,
      cardId,
      text,
      model: generation.value.model,
      promptVersion: QUESTION_CLAIMS.version,
      createdAt,
    })),
  );
  return ok(deps.questions.claimsForSkill(skill.id));
}

interface BuildInput {
  readonly skill: Skill;
  readonly cardId: number;
  readonly material: string;
  readonly own: readonly Claim[];
  readonly pool: readonly Claim[];
  readonly neighbours: readonly Skill[];
  readonly wanted: number;
  readonly deps: QuestionsDeps;
  readonly random: () => number;
}

async function buildQuestions(
  input: BuildInput,
): Promise<{ written: number; dropped: readonly string[] }> {
  const { skill, deps, random } = input;
  const nameOf = new Map(input.neighbours.map((n) => [n.id, n.name]));
  const involvedNames = [skill.name, ...input.neighbours.map((n) => n.name)];

  // One verdict per claim for the whole run: the same neighbour claim is offered to
  // several questions, and re-asking would spend a model call to learn what we know.
  const verdicts = new Map<number, boolean>();

  let written = 0;
  const dropped: string[] = [];

  for (const correct of input.own) {
    if (written >= input.wanted) break;

    const distractors = await selectDistractors(input, correct, verdicts, random);
    if (distractors.length < DISTRACTORS_NEEDED) {
      // Rule 3, literally: too few plausible wrong answers means no question, not a
      // question with a made-up fourth option.
      dropped.push('too-few-distractors');
      continue;
    }

    const stem = await deps.llm.generate({
      system: SYSTEM_PREAMBLE,
      prompt: render(QUESTION_STEM, {
        SKILL: skill.name,
        CORRECT: correct.text,
        DISTRACTORS: distractors
          .map((d) => `- ${d.text}  (describes ${nameOf.get(d.skillId) ?? 'a related technology'})`)
          .join('\n'),
        LANGUAGE: languageName(skill.contentLang),
      }),
      schema: StemSchema,
    });
    if (!stem.ok) {
      dropped.push(`stem-failed:${stem.error.code}`);
      continue;
    }

    const options: CandidateOption[] = shuffle(
      [
        { text: correct.text, isCorrect: true, sourceSkillId: null },
        ...distractors.map((d) => ({
          text: d.text,
          isCorrect: false,
          sourceSkillId: d.skillId,
        })),
      ],
      random,
    );

    const violations = validateQuestion({
      stem: stem.value.value.stem,
      explanation: stem.value.value.explanation,
      options,
      involvedNames,
    });
    if (violations.length > 0) {
      dropped.push(...violations);
      continue;
    }

    const persisted: NewOption[] = options.map((option) => ({
      text: option.text.trim(),
      // The technology the option describes. Language-neutral on purpose: the renderer
      // phrases it, so no English sentence lands inside a Turkish question.
      rationale: option.isCorrect
        ? skill.name
        : (nameOf.get(option.sourceSkillId ?? -1) ?? skill.name),
      isCorrect: option.isCorrect,
      sourceSkillId: option.sourceSkillId,
    }));

    deps.questions.insertWithOptions(
      {
        skillId: skill.id,
        cardId: input.cardId,
        stem: stem.value.value.stem.trim(),
        explanation: stem.value.value.explanation.trim(),
        contentLang: skill.contentLang,
        model: stem.value.model,
        promptVersion: QUESTION_STEM.version,
      },
      persisted,
    );
    written += 1;
  }

  if (dropped.length > 0) {
    // Why a candidate was dropped is the diagnostic that says whether the pool, the
    // prompt, or the assembly is at fault — so the reasons are logged, not just the count.
    log.info('pipeline', 'question candidates dropped', {
      skillId: skill.id,
      reasons: dropped.join(', '),
    });
  }
  return { written, dropped };
}

/**
 * Borrowed claims that are clearly false of the target skill.
 *
 * The gate is asked once per claim and the verdict cached. A claim the model cannot rule
 * out is discarded — the prompt is written so that uncertainty answers "could be true",
 * because a lost distractor costs one option and an ambiguous one costs the reader's trust.
 */
async function selectDistractors(
  input: BuildInput,
  correct: Claim,
  verdicts: Map<number, boolean>,
  random: () => number,
): Promise<readonly Claim[]> {
  const { skill, deps } = input;
  const candidates = shuffle(
    input.pool.filter((claim) => claim.id !== correct.id),
    random,
  ).slice(0, MAX_CANDIDATES_PER_QUESTION);

  const chosen: Claim[] = [];
  for (const candidate of candidates) {
    if (chosen.length >= DISTRACTORS_NEEDED) break;

    const cached = verdicts.get(candidate.id);
    if (cached !== undefined) {
      if (cached) chosen.push(candidate);
      continue;
    }

    const verdict = await deps.llm.generate({
      system: SYSTEM_PREAMBLE,
      prompt: render(DISCRIMINATE_CLAIM, {
        SKILL: skill.name,
        MATERIAL: input.material,
        CLAIM: candidate.text,
      }),
      schema: DiscriminationSchema,
    });

    // A gate that cannot answer does not let anything through.
    const usable = verdict.ok && !verdict.value.value.couldBeTrue;
    verdicts.set(candidate.id, usable);
    if (usable) chosen.push(candidate);
  }
  return chosen;
}

function languageName(language: ContentLanguage): string {
  return LANGUAGE_NAMES[language] ?? 'English';
}

function mentionsAny(text: string, names: readonly string[]): boolean {
  return names.some((name) => mentions(text, name));
}

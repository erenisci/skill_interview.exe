import type { Card, Claim, ContentLanguage, Job, Skill } from '@shared/domain';
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
  CONTRASTIVE_CLAIMS,
  LANGUAGE_NAMES,
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
  stripLeadingSubject,
  validateQuestion,
  type CandidateOption,
} from './question-validate';

/**
 * Question generation — the stage the product is judged on.
 *
 * The shape follows from rule 3: **distractors come from the user's own sibling skills,
 * assembled by code.** A model asked to invent three wrong answers writes three obviously
 * wrong ones, or one that is accidentally right. A neighbouring technology supplies wrong
 * answers that are *true statements about something else* — the confusion a real interview
 * probes.
 *
 * The hard part is that neighbours are neighbours *because* they are similar, so a claim
 * about Traefik may be true of nginx too. That produces a question with two correct
 * options, where the reader answers correctly and is told they are wrong.
 *
 * The first design guarded that with a separate gate, asking after the fact whether a
 * borrowed claim was false of the target. Measured against a real model it left 1 of 28
 * claims standing, because it could reject only where the material explicitly contradicted
 * a claim — and material about one technology is silent about nearly everything another
 * one does.
 *
 * So the separation is now made **during generation, with both technologies in view**:
 * one call per pair returns what is true of each and false of the other. That is the
 * judgement the comparison card already shows the model makes well
 * ([ADR-0006](../../../docs/architecture/adr/0006-pairwise-claims.md)).
 */

const ContrastiveSchema = structured(
  'contrastive-claims',
  z.object({ aClaims: z.array(z.string()), bClaims: z.array(z.string()) }),
);

const StemSchema = structured(
  'question-stem',
  z.object({ stem: z.string(), explanation: z.string() }),
);

export const TARGET_QUESTIONS = 5;
export const DISTRACTORS_NEEDED = 3;

const MAX_MATERIAL_CHARS = 3_000;
/** Both sides plus the prompt have to fit the context window alongside the model. */
const MAX_PAIRS_PER_RUN = 4;

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

    const primer = primerFor(deps, skill.id);
    if (!primer) {
      return err(
        appError('validation', 'no-primer', `skill ${skill.id} has no primer to draw claims from`),
      );
    }

    const missing = TARGET_QUESTIONS - deps.questions.countBySkill(skill.id);
    if (missing <= 0) {
      log.info('pipeline', 'skill already has its questions', { skillId: skill.id });
      return ok(undefined);
    }

    const neighbours = neighbourSkills(deps, skill.id);
    if (neighbours.length === 0) {
      // Not an error, and not permanent: nothing else has been researched yet. Each
      // neighbour's own job re-enqueues this one once it exists.
      log.info('pipeline', 'no neighbours yet, questions deferred', { skillId: skill.id });
      return ok(undefined);
    }

    // A question the user rejected must not return because the job ran again, and a claim
    // already asked about must not be asked twice.
    const asked = new Set(deps.questions.askedClaimTexts(skill.id).map(normalizeClaim));

    const chosen = shuffle(neighbours, random).slice(0, MAX_PAIRS_PER_RUN);
    const dropped: string[] = [];
    const nameOf = new Map(chosen.map((n) => [n.id, n.name]));

    // Every pair first, then one pool.
    //
    // A pair of near-identical tools yields roughly one solid separating claim per side —
    // measured, and pushing the prompt for more costs the naming rule and the separation
    // itself. So a question borrows from several neighbours rather than three times from
    // one, which is also closer to what the product promises: the wrong answers are drawn
    // from the user's skill list, not from one entry in it
    // ([ADR-0006](../../../docs/architecture/adr/0006-pairwise-claims.md)).
    for (const neighbour of chosen) {
      const pair = await ensurePairClaims(skill, primer, neighbour, deps, now);
      if (!pair.ok) dropped.push(`pair-failed:${pair.error.code}`);
    }

    const own = deps.questions
      .claimsAbout(
        skill.id,
        chosen.map((n) => n.id),
      )
      .filter((claim) => !asked.has(normalizeClaim(claim.text)));

    // Each of these was written to be false of this skill specifically, which is what
    // makes it safe to show as a wrong answer.
    const pool = deps.questions.claimsAgainst(
      skill.id,
      chosen.map((n) => n.id),
    );

    let written = 0;
    if (pool.length < DISTRACTORS_NEEDED) {
      // Rule 3, literally: too few plausible wrong answers means no question, not a
      // question with a made-up fourth option.
      dropped.push(`too-few-distractors:${pool.length}`);
    } else {
      for (const correct of shuffle(own, random)) {
        if (written >= missing) break;

        const built = await buildOne(skill, primer.id, correct, pool, nameOf, deps, random);
        if (!built.ok) {
          dropped.push(built.error.code);
          continue;
        }
        asked.add(normalizeClaim(correct.text));
        written += 1;
      }
    }

    // A neighbour with no questions of its own can now be asked about. Only those with
    // nothing yet, so this settles instead of bouncing between two skills forever.
    const createdAt = now().toISOString();
    for (const neighbour of neighbours) {
      if (deps.questions.countBySkill(neighbour.id) === 0) {
        deps.jobs.enqueue('generate-questions', { skillId: neighbour.id }, createdAt);
      }
    }

    if (dropped.length > 0) {
      // Why a candidate was dropped is the diagnostic that says whether the pool, the
      // prompt, or the assembly is at fault.
      log.info('pipeline', 'question candidates dropped', {
        skillId: skill.id,
        reasons: dropped.join(', '),
      });
    }
    log.info('pipeline', 'questions written', { skillId: skill.id, written });
    return ok(undefined);
  };
}

function primerFor(deps: QuestionsDeps, skillId: number): Card | null {
  return deps.cards.listBySkill(skillId).find((card) => card.type === 'primer') ?? null;
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

/**
 * Writes both directions of a pair in one call, unless they already exist.
 *
 * One call rather than two: separating A from B and B from A is the same judgement, and
 * asking twice invites the model to contradict itself.
 */
async function ensurePairClaims(
  skill: Skill,
  primer: Card,
  neighbour: Skill,
  deps: QuestionsDeps,
  now: () => Date,
): Promise<Result<void>> {
  if (deps.questions.pairWritten(skill.id, neighbour.id)) return ok(undefined);

  const neighbourPrimer = primerFor(deps, neighbour.id);
  if (!neighbourPrimer) {
    return err(
      appError('validation', 'neighbour-unresearched', `${neighbour.name} has no primer yet`),
    );
  }

  const generation = await deps.llm.generate({
    system: SYSTEM_PREAMBLE,
    prompt: render(CONTRASTIVE_CLAIMS, {
      SKILL_A: skill.name,
      MATERIAL_A: truncate(primer.bodyMd, MAX_MATERIAL_CHARS),
      SKILL_B: neighbour.name,
      MATERIAL_B: truncate(neighbourPrimer.bodyMd, MAX_MATERIAL_CHARS),
      LANGUAGE: languageName(skill.contentLang),
    }),
    schema: ContrastiveSchema,
  });
  if (!generation.ok) return generation;

  const createdAt = now().toISOString();
  const names = [skill.name, neighbour.name];

  // A claim naming either technology is unusable as an option, so it is dropped here
  // rather than surviving to be caught by the validator a stage later.
  //
  // A name used as the sentence's subject is stripped rather than dropped: measured, that
  // form is the commonest way a correct claim becomes unusable, and it is a prefix rather
  // than a flaw in the content. A name left anywhere else still costs the claim.
  const clean = (texts: readonly string[]): readonly string[] =>
    texts
      .map((text) => stripLeadingSubject(text, names))
      .filter((text) => text.length > 0)
      .filter((text) => !names.some((name) => mentions(text, name)));

  deps.questions.replaceClaimsForPair(
    skill.id,
    neighbour.id,
    clean(generation.value.value.aClaims).map((text) => ({
      skillId: skill.id,
      contrastSkillId: neighbour.id,
      cardId: primer.id,
      text,
      model: generation.value.model,
      promptVersion: CONTRASTIVE_CLAIMS.version,
      createdAt,
    })),
  );
  deps.questions.replaceClaimsForPair(
    neighbour.id,
    skill.id,
    clean(generation.value.value.bClaims).map((text) => ({
      skillId: neighbour.id,
      contrastSkillId: skill.id,
      cardId: neighbourPrimer.id,
      text,
      model: generation.value.model,
      promptVersion: CONTRASTIVE_CLAIMS.version,
      createdAt,
    })),
  );
  return ok(undefined);
}

async function buildOne(
  skill: Skill,
  cardId: number,
  correct: Claim,
  pool: readonly Claim[],
  nameOf: ReadonlyMap<number, string>,
  deps: QuestionsDeps,
  random: () => number,
): Promise<Result<void>> {
  // Spread across neighbours where there are enough of them: three wrong answers from
  // three different technologies teach more than three from one.
  const distractors = spread(shuffle(pool, random)).slice(0, DISTRACTORS_NEEDED);
  const involved = [skill.name, ...new Set(distractors.map((d) => nameOf.get(d.skillId) ?? ''))];

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
  if (!stem.ok) return err(appError('validation', `stem-failed:${stem.error.code}`, 'no stem'));

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
    involvedNames: involved.filter((name) => name.length > 0),
  });
  if (violations.length > 0) {
    return err(appError('validation', violations.join('+'), 'candidate rejected'));
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
      cardId,
      stem: stem.value.value.stem.trim(),
      explanation: stem.value.value.explanation.trim(),
      contentLang: skill.contentLang,
      model: stem.value.model,
      promptVersion: QUESTION_STEM.version,
    },
    persisted,
  );
  return ok(undefined);
}

/** One claim per source skill first, then the rest — so a question spans the skill list. */
function spread(claims: readonly Claim[]): readonly Claim[] {
  const seen = new Set<number>();
  const first: Claim[] = [];
  const rest: Claim[] = [];
  for (const claim of claims) {
    if (seen.has(claim.skillId)) rest.push(claim);
    else {
      seen.add(claim.skillId);
      first.push(claim);
    }
  }
  return [...first, ...rest];
}

function languageName(language: ContentLanguage): string {
  return LANGUAGE_NAMES[language] ?? 'English';
}

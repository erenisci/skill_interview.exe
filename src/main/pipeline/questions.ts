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

/**
 * **Claims in the requested language are still an open problem, and this schema is the
 * honest state of it.**
 *
 * Two fixes were tried and measured against frozen sources and a real model. Stating the
 * requirement last — the change that took the primer card from 33% to 100% (TD-18) — scored
 * 2 of 4 pairs, with Türkçe answered in English. Adding a leading `language` field to make
 * the model declare its intent first, the lever that fixed `resolve-source`, also scored
 * 2 of 4, and failed differently: Türkçe pairs came back empty rather than wrong.
 *
 * Neither is a fix, so neither is kept. What ships is the simpler of the two, and the guard
 * in `ensurePairClaims` turns the failure into a visible absence rather than an English
 * option in a Turkish question ([TD-19](../../../docs/project/tech-debt.md)).
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

/**
 * Measured (`evals/probes/context-probe.mjs`, 2026-09-03): two sides at this budget run
 * ~1,992 input tokens against `num_ctx: 4096`, with the claim arrays this prompt returns
 * far smaller than a primer body — comfortable headroom either way.
 */
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

    const neighbours = borrowFrom(deps, skill.id, random);
    if (neighbours.length === 0) {
      // Not an error, and not permanent: nothing else has been researched yet. Each
      // neighbour's own job re-enqueues this one once it exists.
      log.info('pipeline', 'no neighbours yet, questions deferred', { skillId: skill.id });
      return ok(undefined);
    }

    // A question the user rejected must not return because the job ran again, and a claim
    // already asked about must not be asked twice.
    const asked = new Set(deps.questions.askedClaimTexts(skill.id).map(normalizeClaim));

    // Already ordered by preference and shuffled within each tier, so this takes the best
    // available rather than a random sample of everything.
    const chosen = neighbours.slice(0, MAX_PAIRS_PER_RUN);
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
    let wroteClaims = false;
    for (const neighbour of chosen) {
      const pair = await ensurePairClaims(skill, primer, neighbour, deps, now);
      if (!pair.ok) dropped.push(`pair-failed:${pair.error.code}`);
      else if (pair.value) wroteClaims = true;
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

    // A neighbour with no questions of its own can now be asked about — but only if this
    // run actually produced something it could use.
    //
    // **The "has no questions yet" guard alone does not terminate**, and the comment here
    // used to claim it did. When a set of skills cannot yield a question at all — three
    // neighbours are needed and only two exist ([TD-14](../../../docs/project/tech-debt.md))
    // — that condition stays true forever, so each job re-enqueued its neighbours, which
    // re-enqueued it back. Found on a real database with 45 pending jobs and climbing, none
    // of which could ever write anything.
    //
    // New claims or new questions are the only things a neighbour's next run could benefit
    // from. Neither means there is nothing to wake it for.
    if (wroteClaims || written > 0) {
      const createdAt = now().toISOString();
      for (const neighbour of neighbours) {
        if (deps.questions.countBySkill(neighbour.id) === 0) {
          deps.jobs.enqueueUnique('generate-questions', { skillId: neighbour.id }, createdAt);
        }
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
/**
 * Who this skill can borrow wrong answers from — graph neighbours first, then anyone else
 * on the list.
 *
 * Restricting this to graph neighbours was wrong, and a real user found it immediately.
 * Four languages produced no questions at all: three were linked and so had two neighbours
 * each, one short of the three distractors a question needs, and the fourth had failed
 * classification and so had none. The screen's honest answer — "add 3 more skills in the
 * same area" — is not an answer at all. Nobody's CV grows on request, and telling someone
 * to invent three more Java-like skills is telling them the product does not work.
 *
 * The safety rule was never "the distractor comes from a neighbour". It is that a claim
 * must be **false of this skill**, and that is established by generating the pair with both
 * technologies in view ([ADR-0006](../../../docs/architecture/adr/0006-pairwise-claims.md))
 * — which works for any two skills, related or not. The graph decides how *good* a
 * distractor is, not whether it is safe.
 *
 * So neighbours come first and are still preferred, because a similar technology makes the
 * sharper question. Only what is missing is filled from the rest of the researched list. A
 * question whose wrong answers come from a less similar skill is easier than the ideal; no
 * question at all is the product failing.
 *
 * The shuffle happens **within each tier rather than across both**, which is the whole
 * point and was wrong in the first draft: shuffling the combined list and taking the first
 * few can drop a real neighbour in favour of an unrelated skill, quietly undoing the
 * preference this function exists to express. A test caught it.
 */
function borrowFrom(deps: QuestionsDeps, skillId: number, random: () => number): readonly Skill[] {
  const related: Skill[] = [];
  const seen = new Set<number>([skillId]);

  for (const relation of deps.relations.listFor(skillId)) {
    const other = deps.skills.findById(RelationsRepository.otherSide(relation, skillId));
    if (other && !seen.has(other.id)) {
      seen.add(other.id);
      related.push(other);
    }
  }
  if (related.length >= DISTRACTORS_NEEDED) return shuffle(related, random);

  // The fallback tier is filtered on having material rather than on `status`, because
  // material is the actual requirement: a pair cannot be separated from a skill with no
  // primer to read. Related skills are left unfiltered — `ensurePairClaims` reports that
  // case as `neighbour-unresearched`, a diagnostic worth keeping.
  const rest = deps.skills
    .list()
    .filter((other) => !seen.has(other.id) && primerFor(deps, other.id) !== null);
  return [...shuffle(related, random), ...shuffle(rest, random)];
}

/**
 * Writes both directions of a pair in one call, unless they already exist.
 *
 * One call rather than two: separating A from B and B from A is the same judgement, and
 * asking twice invites the model to contradict itself.
 */
/** What one contrastive call produced, already cleaned but not yet stored. */
export interface PairClaims {
  readonly aClaims: readonly string[];
  readonly bClaims: readonly string[];
  readonly model: string;
}

/**
 * Asks the model to separate two technologies, and cleans what comes back.
 *
 * Separate from storing it so the eval harness can measure this exact step against frozen
 * material — the alternative is the harness re-implementing the prompt call, which is how
 * an eval quietly stops measuring what actually ships
 * ([eval-harness.md](../../../docs/llm/eval-harness.md)).
 */
export async function generatePairClaims(
  llm: LlmAdapter,
  a: { readonly name: string; readonly material: string },
  b: { readonly name: string; readonly material: string },
  language: ContentLanguage,
): Promise<Result<PairClaims>> {
  const generation = await llm.generate({
    system: SYSTEM_PREAMBLE,
    prompt: render(CONTRASTIVE_CLAIMS, {
      SKILL_A: a.name,
      MATERIAL_A: truncate(a.material, MAX_MATERIAL_CHARS),
      SKILL_B: b.name,
      MATERIAL_B: truncate(b.material, MAX_MATERIAL_CHARS),
      LANGUAGE: languageName(language),
    }),
    schema: ContrastiveSchema,
  });
  if (!generation.ok) return generation;

  const names = [a.name, b.name];

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

  return ok({
    aClaims: clean(generation.value.value.aClaims),
    bClaims: clean(generation.value.value.bClaims),
    model: generation.value.model,
  });
}

/** Whether this call actually wrote new claims, which is what a neighbour could gain from. */
async function ensurePairClaims(
  skill: Skill,
  primer: Card,
  neighbour: Skill,
  deps: QuestionsDeps,
  now: () => Date,
): Promise<Result<boolean>> {
  if (deps.questions.pairWritten(skill.id, neighbour.id)) return ok(false);

  const neighbourPrimer = primerFor(deps, neighbour.id);
  if (!neighbourPrimer) {
    return err(
      appError('validation', 'neighbour-unresearched', `${neighbour.name} has no primer yet`),
    );
  }

  const generated = await generatePairClaims(
    deps.llm,
    { name: skill.name, material: primer.bodyMd },
    { name: neighbour.name, material: neighbourPrimer.bodyMd },
    skill.contentLang,
  );
  if (!generated.ok) return generated;

  const createdAt = now().toISOString();

  // Pairs are generated independently, so the same fact comes back twice in different
  // words — measured on a real run, against two different neighbours. Dropping the later
  // wording keeps the pool honest without another model call; the earlier one is already
  // stored and already the subject of whatever question used it.
  const seen = new Set(
    [...deps.questions.claimTextsFor(skill.id), ...deps.questions.claimTextsFor(neighbour.id)].map(
      normalizeClaim,
    ),
  );
  const fresh = (text: string): boolean => {
    const key = normalizeClaim(text);
    if (key.length === 0 || seen.has(key)) return false;
    seen.add(key);
    return true;
  };

  deps.questions.replaceClaimsForPair(
    skill.id,
    neighbour.id,
    generated.value.aClaims.filter(fresh).map((text) => ({
      skillId: skill.id,
      contrastSkillId: neighbour.id,
      cardId: primer.id,
      text,
      model: generated.value.model,
      promptVersion: CONTRASTIVE_CLAIMS.version,
      createdAt,
    })),
  );
  deps.questions.replaceClaimsForPair(
    neighbour.id,
    skill.id,
    generated.value.bClaims.filter(fresh).map((text) => ({
      skillId: neighbour.id,
      contrastSkillId: skill.id,
      cardId: neighbourPrimer.id,
      text,
      model: generated.value.model,
      promptVersion: CONTRASTIVE_CLAIMS.version,
      createdAt,
    })),
  );
  return ok(true);
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

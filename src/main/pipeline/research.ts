import type { Job } from '@shared/domain';
import { appError, err, ok, type Result } from '@shared/result';
import type { CardsRepository } from '../db/repositories/cards';
import type { JobsRepository } from '../db/repositories/jobs';
import type { RelationsRepository } from '../db/repositories/relations';
import type { SkillsRepository } from '../db/repositories/skills';
import type { LlmAdapter } from '../llm/adapter';
import type { JobHandler } from '../queue/queue';
import type { SearchAdapter } from '../search/adapter';
import { truncate } from '../search/extract';
import { log } from '../util/logger';
import { classifySkill } from './classify';
import { earnsComparison, relationsFor, type Relation } from './relate';
import { resolveSource } from './resolve';
import { synthesizePrimer } from './synthesize';

/**
 * The research pipeline for one skill, in the order the architecture prescribes:
 *
 *   search → resolve → fetch → truncate → synthesize → persist
 *
 * Every stage can end the job, and none of them degrades into writing something anyway.
 * The failure this ordering exists to prevent is a fluent card about the wrong subject
 * ([ADR-0003](../../../docs/architecture/adr/0003-source-resolution.md)).
 */

export interface ResearchDeps {
  readonly skills: SkillsRepository;
  readonly cards: CardsRepository;
  readonly relations: RelationsRepository;
  readonly jobs: JobsRepository;
  readonly search: SearchAdapter;
  readonly llm: LlmAdapter;
  /**
   * Bounded by VRAM as much as by the prompt (docs/operations/performance.md). The default
   * is measured, not guessed — see `DEFAULT_MAX_SOURCE_CHARS`.
   */
  readonly maxSourceChars?: number;
  readonly now?: () => Date;
}

export interface ResearchPayload {
  readonly skillId: number;
}

/**
 * Measured against real articles (`evals/probes/context-probe.mjs`, 2026-09-03): PostgreSQL
 * and Kubernetes run 32,000–39,000 characters, so this always truncates on a substantial
 * source, and it is the budget the default `num_ctx: 4096` in ollama.ts was sized against —
 * raising one without the other risks the source alone overflowing the window before the
 * model writes a word.
 */
const DEFAULT_MAX_SOURCE_CHARS = 8_000;

export function createResearchHandler(deps: ResearchDeps): JobHandler {
  const now = deps.now ?? (() => new Date());
  const maxSourceChars = deps.maxSourceChars ?? DEFAULT_MAX_SOURCE_CHARS;

  return async (job: Job): Promise<Result<void>> => {
    let payload: ResearchPayload;
    try {
      payload = JSON.parse(job.payload) as ResearchPayload;
    } catch {
      return err(appError('internal', 'bad-payload', `job ${job.id} has unparseable payload`));
    }

    const skill = deps.skills.findById(payload.skillId);
    if (!skill) {
      // Deleted while queued. Nothing to do, and nothing wrong — succeed quietly.
      log.info('pipeline', 'skill gone before research ran', { skillId: payload.skillId });
      return ok(undefined);
    }

    deps.skills.setStatus(skill.id, 'researching');

    const candidates = await deps.search.findCandidates(skill.name);
    if (!candidates.ok) return candidates;

    const resolved = await resolveSource(skill.name, candidates.value, { llm: deps.llm });
    if (!resolved.ok) return resolved;

    // Only now is any text downloaded: a candidate that failed the gates costs nothing.
    const text = await deps.search.fetchText(resolved.value.candidate);
    if (!text.ok) return text;

    const excerpt = truncate(text.value, maxSourceChars);

    const card = await synthesizePrimer(skill.name, excerpt, skill.contentLang, { llm: deps.llm });
    if (!card.ok) return card;

    const fetchedAt = now().toISOString();
    const source = resolved.value.candidate;

    deps.cards.insertWithSources(
      {
        skillId: skill.id,
        type: 'primer',
        title: card.value.title,
        bodyMd: card.value.body,
        contentLang: skill.contentLang,
        model: card.value.model,
        promptVersion: card.value.promptVersion,
        createdAt: fetchedAt,
      },
      [
        {
          skillId: skill.id,
          url: source.url,
          title: source.title,
          publisher: source.publisher,
          license: source.license,
          fetchedAt,
          // The text the model actually saw, not the page it came from.
          excerpt,
        },
      ],
    );

    // Classification comes after synthesis on purpose: the model classifies far more
    // reliably from retrieved text than from a bare name.
    //
    // **It is not allowed to fail the job.** The card is the primary output and it is
    // already written; throwing it away because the model returned one usable tag would
    // be wildly disproportionate. An unclassified skill simply has no neighbours yet —
    // a degraded state the user can see, not a lost one
    // ([system-design.md](../../../docs/architecture/system-design.md)).
    const classification = await classifySkill(skill.name, excerpt, { llm: deps.llm });
    let relationCount = 0;

    if (classification.ok) {
      deps.skills.setClassification(
        skill.id,
        classification.value.category,
        classification.value.tags,
      );

      const relations = relationsFor(
        { id: skill.id, category: classification.value.category, tags: classification.value.tags },
        deps.relations.classifiedSkills(skill.id),
      );
      deps.relations.replaceFor(skill.id, relations);
      enqueueComparisons(deps, relations, fetchedAt);
      relationCount = relations.length;
    } else {
      log.warn('pipeline', 'skill left unclassified, card kept', {
        skillId: skill.id,
        code: classification.error.code,
      });
    }

    // Questions are enqueued whether or not the skill was classified. An unclassified
    // skill has no neighbours to borrow distractors from yet, and the handler treats that
    // as "come back later" rather than as a failure.
    deps.jobs.enqueue('generate-questions', { skillId: skill.id }, fetchedAt);

    deps.skills.setStatus(skill.id, 'ready');
    log.info('pipeline', 'primer written', {
      skillId: skill.id,
      provider: source.provider,
      classified: classification.ok,
      relations: relationCount,
    });
    return ok(undefined);
  };
}

/**
 * A weak relation is a neighbour, not a card. Without the strength gate a category with
 * many members would generate comparisons combinatorially, most of them saying nothing
 * ([system-design.md](../../../docs/architecture/system-design.md)).
 */
function enqueueComparisons(deps: ResearchDeps, relations: readonly Relation[], now: string): void {
  for (const relation of relations) {
    if (!earnsComparison(relation)) continue;
    deps.jobs.enqueue('compare', { skillAId: relation.skillAId, skillBId: relation.skillBId }, now);
  }
}

/**
 * Marks the skill failed when its research job gives up for good. The handler cannot do
 * this itself: it does not know whether the queue will retry, and a skill left
 * `researching` forever is exactly the silent failure the error policy forbids.
 */
export function createResearchFailureHandler(skills: SkillsRepository) {
  return (job: Job): void => {
    try {
      const { skillId } = JSON.parse(job.payload) as ResearchPayload;
      if (skills.findById(skillId)) skills.setStatus(skillId, 'failed');
    } catch {
      log.warn('pipeline', 'could not mark a skill failed', { jobId: job.id });
    }
  };
}

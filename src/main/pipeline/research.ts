import { appError, err, ok, type Result } from '@shared/result';
import type { Job } from '@shared/domain';
import type { CardsRepository } from '../db/repositories/cards';
import type { SkillsRepository } from '../db/repositories/skills';
import type { LlmAdapter } from '../llm/adapter';
import type { JobHandler } from '../queue/queue';
import type { SearchAdapter } from '../search/adapter';
import { truncate } from '../search/extract';
import { log } from '../util/logger';
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
  readonly search: SearchAdapter;
  readonly llm: LlmAdapter;
  /** Bounded by VRAM as much as by the prompt (docs/operations/performance.md). */
  readonly maxSourceChars?: number;
  readonly now?: () => Date;
}

export interface ResearchPayload {
  readonly skillId: number;
}

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

    deps.skills.setStatus(skill.id, 'ready');
    log.info('pipeline', 'primer written', { skillId: skill.id, provider: source.provider });
    return ok(undefined);
  };
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

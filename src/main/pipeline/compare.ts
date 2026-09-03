import { z } from 'zod';
import { appError, err, ok, type Result } from '@shared/result';
import type { Job } from '@shared/domain';
import type { CardsRepository, NewSource } from '../db/repositories/cards';
import type { SkillsRepository } from '../db/repositories/skills';
import type { LlmAdapter } from '../llm/adapter';
import { structured } from '../llm/schema';
import { COMPARISON_CARD, LANGUAGE_NAMES, SYSTEM_PREAMBLE, render } from '../llm/prompts';
import type { JobHandler } from '../queue/queue';
import { truncate } from '../search/extract';
import { log } from '../util/logger';
import { MAX_BODY_CHARS, MIN_BODY_CHARS } from './synthesize';

/**
 * Writes the card the product exists for: what actually differs between two of the
 * user's own skills.
 *
 * It reuses the material already retrieved for each skill rather than searching again —
 * the sources were resolved and stored precisely so they could be used more than once.
 */

const ComparisonSchema = structured(
  'comparison-card',
  z.object({ title: z.string(), body: z.string() }),
);

export interface CompareDeps {
  readonly skills: SkillsRepository;
  readonly cards: CardsRepository;
  readonly llm: LlmAdapter;
  readonly maxSourceChars?: number;
  readonly now?: () => Date;
}

export interface ComparePayload {
  readonly skillAId: number;
  readonly skillBId: number;
}

const DEFAULT_MAX_SOURCE_CHARS = 4_000;

export function createCompareHandler(deps: CompareDeps): JobHandler {
  const now = deps.now ?? (() => new Date());
  const perSide = deps.maxSourceChars ?? DEFAULT_MAX_SOURCE_CHARS;

  return async (job: Job): Promise<Result<void>> => {
    let payload: ComparePayload;
    try {
      payload = JSON.parse(job.payload) as ComparePayload;
    } catch {
      return err(appError('internal', 'bad-payload', `job ${job.id} has unparseable payload`));
    }

    const a = deps.skills.findById(payload.skillAId);
    const b = deps.skills.findById(payload.skillBId);
    if (!a || !b) {
      // One of them was deleted while the job waited. The relation is gone with it.
      log.info('pipeline', 'comparison skipped, a skill is gone', { jobId: job.id });
      return ok(undefined);
    }

    const sourcesA = deps.cards.sourcesForSkill(a.id);
    const sourcesB = deps.cards.sourcesForSkill(b.id);
    if (sourcesA.length === 0 || sourcesB.length === 0) {
      return err(
        appError(
          'validation',
          'missing-material',
          'a comparison needs stored sources for both skills',
        ),
      );
    }

    const materialA = truncate(sourcesA.map((s) => s.excerpt).join('\n\n'), perSide);
    const materialB = truncate(sourcesB.map((s) => s.excerpt).join('\n\n'), perSide);

    const generation = await deps.llm.generate({
      system: SYSTEM_PREAMBLE,
      prompt: render(COMPARISON_CARD, {
        SKILL_A: a.name,
        SKILL_B: b.name,
        MATERIAL_A: materialA,
        MATERIAL_B: materialB,
        LANGUAGE: LANGUAGE_NAMES[a.contentLang] ?? 'English',
      }),
      schema: ComparisonSchema,
    });
    if (!generation.ok) return generation;

    const body = generation.value.value.body.trim();
    if (body.length < MIN_BODY_CHARS || body.length > MAX_BODY_CHARS) {
      return err(
        appError(
          'validation',
          'body-out-of-band',
          `comparison was ${body.length} characters, outside ${MIN_BODY_CHARS}–${MAX_BODY_CHARS}`,
        ),
      );
    }

    const createdAt = now().toISOString();
    // Both sides' provenance travels with the card: it is grounded in both.
    const sources: NewSource[] = [...sourcesA, ...sourcesB].map((source) => ({
      skillId: source.skillId,
      url: source.url,
      title: source.title,
      publisher: source.publisher,
      license: source.license,
      fetchedAt: createdAt,
      excerpt: source.excerpt,
    }));

    deps.cards.insertWithSources(
      {
        skillId: a.id,
        relatedSkillId: b.id,
        type: 'comparison',
        title: generation.value.value.title.trim() || `${a.name} vs ${b.name}`,
        bodyMd: body,
        contentLang: a.contentLang,
        model: generation.value.model,
        promptVersion: COMPARISON_CARD.version,
        createdAt,
      },
      sources,
    );

    log.info('pipeline', 'comparison written', { skillAId: a.id, skillBId: b.id });
    return ok(undefined);
  };
}

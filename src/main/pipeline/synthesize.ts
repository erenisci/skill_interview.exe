import type { ContentLanguage } from '@shared/domain';
import { appError, err, ok, type Result } from '@shared/result';
import { z } from 'zod';
import type { LlmAdapter } from '../llm/adapter';
import { LANGUAGE_NAMES, PRIMER_CARD, SYSTEM_PREAMBLE, render } from '../llm/prompts';
import { structured } from '../llm/schema';
import { looksLikeEnglish, sourceMentionsSkill } from '../util/language';

/**
 * Writes a primer from retrieved text, and from nothing else.
 *
 * The rule this stage exists to enforce: **the model is a writer working from supplied
 * material, never a source of facts.** There is no path here that produces a card when
 * the material is missing — an empty source is a caller error, not something to write
 * around (docs/llm/architecture.md).
 */

const PrimerSchema = structured(
  'primer-card',
  z.object({
    title: z.string(),
    body: z.string(),
  }),
);

/**
 * Provisional, and marked as such: "1–2 pages" has to become characters somewhere, and
 * these bounds have not yet been checked against real generated cards. The lower bound is
 * the one doing real work — it catches a model that answered with a sentence.
 */
export const MIN_BODY_CHARS = 400;
export const MAX_BODY_CHARS = 6000;

export interface SynthesizedCard {
  readonly title: string;
  readonly body: string;
  readonly model: string;
  readonly promptVersion: string;
}

export interface SynthesizeDeps {
  readonly llm: LlmAdapter;
}

export async function synthesizePrimer(
  skill: string,
  sourceText: string,
  language: ContentLanguage,
  deps: SynthesizeDeps,
  signal?: AbortSignal,
): Promise<Result<SynthesizedCard>> {
  if (sourceText.trim().length === 0) {
    return err(
      appError('internal', 'no-source-text', 'synthesis was called without source material'),
    );
  }

  // Grounding, enforced before the model is asked rather than hoped for afterwards.
  //
  // Resolution already decided this source is about the subject, but extraction can still
  // hand over a sign-in page or a consent dialog from the same URL — and measured, the
  // model fills that space from its own memory and produces a fluent, sourceless card
  // ([TD-17](../../../docs/project/tech-debt.md)). Length alone did not catch it: a
  // sign-in page has enough words to clear the minimum.
  if (!sourceMentionsSkill(sourceText, skill)) {
    return err(
      appError(
        'provider',
        'source-not-about-skill',
        `the retrieved text never mentions "${skill}", so there is nothing to write from`,
      ),
    );
  }

  const generation = await deps.llm.generate({
    system: SYSTEM_PREAMBLE,
    prompt: render(PRIMER_CARD, {
      SKILL: skill,
      SOURCE: sourceText,
      LANGUAGE: LANGUAGE_NAMES[language] ?? 'English',
    }),
    schema: PrimerSchema,
    ...(signal ? { signal } : {}),
  });
  if (!generation.ok) return generation;

  const { title, body } = generation.value.value;
  const trimmed = body.trim();

  // Out of band is a validation failure, which the queue retries — rather than an inner
  // reformat loop that would hide a model consistently answering with one sentence.
  if (trimmed.length < MIN_BODY_CHARS) {
    return err(
      appError(
        'validation',
        'body-too-short',
        `primer was ${trimmed.length} characters, below the ${MIN_BODY_CHARS} minimum`,
      ),
    );
  }
  if (trimmed.length > MAX_BODY_CHARS) {
    return err(
      appError(
        'validation',
        'body-too-long',
        `primer was ${trimmed.length} characters, above the ${MAX_BODY_CHARS} maximum`,
      ),
    );
  }
  if (title.trim().length === 0) {
    return err(appError('validation', 'no-title', 'primer has no title'));
  }

  // The requested language is a prompt parameter, and measured, a 4B model with an English
  // source in front of it follows the source rather than the instruction
  // ([TD-18](../../../docs/project/tech-debt.md)). A visible failure the queue retries is
  // better than a card silently in the wrong language: the user asked for Turkish and
  // would otherwise get English with no sign anything went wrong.
  if (!looksLikeEnglish(trimmed)) {
    return err(
      appError(
        'validation',
        'wrong-language',
        `primer was asked for in ${language} and did not come back in it`,
      ),
    );
  }

  return ok({
    title: title.trim(),
    body: trimmed,
    model: generation.value.model,
    promptVersion: PRIMER_CARD.version,
  });
}

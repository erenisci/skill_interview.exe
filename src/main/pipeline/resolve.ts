import { z } from 'zod';
import { appError, err, ok, type Result } from '@shared/result';
import type { LlmAdapter } from '../llm/adapter';
import { structured } from '../llm/schema';
import { RESOLVE_SOURCE, SYSTEM_PREAMBLE, render } from '../llm/prompts';
import type { Candidate } from '../search/adapter';
import { log } from '../util/logger';

/**
 * Turns candidates into sources, or refuses.
 *
 * The asymmetry driving every choice here: **a refused source costs an empty state the
 * user can see; an accepted wrong one costs their trust in every card they have read**.
 * So this errs towards refusing ([ADR-0003](../../../docs/architecture/adr/0003-source-resolution.md)).
 */

/** Lowercase alphanumerics only, so separators and casing cannot hide a match. */
function normalize(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '');
}

const MIN_STEM = 3;

/**
 * Calibrated against real names rather than chosen for tidiness. Must pass:
 * `traefik`/`traefikproxy` (0.58), `vue`/`vuejs` (0.60). Must fail: `go`/`google` (0.33),
 * and the two that matter most for this product — `java`/`javascript` (0.40) and
 * `react`/`reactnative` (0.45), which are different technologies wearing similar names.
 * A first attempt at 0.6 rejected Traefik's own Wikipedia article.
 */
const MIN_OVERLAP_RATIO = 0.5;

/**
 * Gate 1 — deterministic and free.
 *
 * A prefix relationship is enough (`traefik` against `traefikproxy`, `expressjs` against
 * `expressjscom`), but only when the shorter name is at least half the longer one.
 * Without the ratio, a short skill would match anything starting with those letters.
 */
export function nameMatches(skill: string, identity: string): boolean {
  const a = normalize(skill);
  const b = normalize(identity);
  if (a.length === 0 || b.length === 0) return false;
  if (a === b) return true;

  const [shorter, longer] = a.length <= b.length ? [a, b] : [b, a];
  if (shorter.length < MIN_STEM) return false;
  if (!longer.startsWith(shorter)) return false;
  return shorter.length / longer.length >= MIN_OVERLAP_RATIO;
}

export function applyNameGate(
  skill: string,
  candidates: readonly Candidate[],
): readonly Candidate[] {
  return candidates.filter((candidate) => nameMatches(skill, candidate.identity));
}

const ResolutionSchema = structured(
  'resolve-source',
  z.object({
    index: z.number().int().nullable(),
    reason: z.string(),
  }),
);

export interface ResolvedSource {
  readonly candidate: Candidate;
  readonly promptVersion: string;
  readonly model: string;
  readonly reason: string;
}

export interface ResolveDeps {
  readonly llm: LlmAdapter;
}

/**
 * Gate 1, then gate 2. Both must pass, and either can end the job.
 *
 * Gate 1 is not sufficient on its own: Wikipedia's article on the ancient Tauri people is
 * titled exactly `Tauri`, so a name match alone accepts entirely the wrong subject. Gate 2
 * is one small model call over short text, which is where a small model is most reliable.
 */
export async function resolveSource(
  skill: string,
  candidates: readonly Candidate[],
  deps: ResolveDeps,
  signal?: AbortSignal,
): Promise<Result<ResolvedSource>> {
  const named = applyNameGate(skill, candidates);
  if (named.length === 0) {
    return err(
      appError(
        'provider',
        'no-name-match',
        `no candidate's name matches "${skill}" (${candidates.length} rejected)`,
      ),
    );
  }

  // One survivor still goes to the subject check: a name match is exactly how the wrong
  // subject gets in, so skipping the check here would defeat the point.
  const listing = named
    .map(
      (candidate, index) =>
        `[${index}] ${candidate.title}\n${candidate.lead || '(no description)'}`,
    )
    .join('\n\n');

  const generation = await deps.llm.generate({
    system: SYSTEM_PREAMBLE,
    prompt: render(RESOLVE_SOURCE, { SKILL: skill, CANDIDATES: listing }),
    schema: ResolutionSchema,
    ...(signal ? { signal } : {}),
  });
  if (!generation.ok) return generation;

  const { index, reason } = generation.value.value;
  if (index === null) {
    return err(
      appError(
        'provider',
        'no-subject-match',
        `none of the ${named.length} name-matching candidates is about "${skill}": ${reason}`,
      ),
    );
  }

  const chosen = named[index];
  if (!chosen) {
    // A constrained schema guarantees an integer, not one that is in range.
    return err(
      appError('validation', 'index-out-of-range', `chose candidate ${index} of ${named.length}`),
    );
  }

  log.info('pipeline', 'source resolved', {
    provider: chosen.provider,
    considered: candidates.length,
    namePassed: named.length,
  });

  return ok({
    candidate: chosen,
    promptVersion: RESOLVE_SOURCE.version,
    model: generation.value.model,
    reason,
  });
}

import { appError, err, ok, type Result } from '@shared/result';
import { z } from 'zod';
import type { LlmAdapter } from '../llm/adapter';
import { RESOLVE_SOURCE, SYSTEM_PREAMBLE, render } from '../llm/prompts';
import { structured } from '../llm/schema';
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
 * Wikipedia disambiguates by appending a qualifier — `Java (programming language)`,
 * `Python (programming language)`, `Go (programming language)`. It is metadata about the
 * title, not part of the name, and leaving it in defeats the ratio below: `java` against
 * `javaprogramminglanguage` scores 0.17 and is rejected, while `Java` — the Indonesian
 * island — is a perfect match and sails through.
 *
 * Measured live against Wikipedia (2026-09-04), the gate discarded the right article and
 * forwarded the wrong one for every language whose article is disambiguated: Java, Python,
 * C, Go, Rust. That is the failure ADR-0003 exists to prevent, arriving through the gate
 * meant to prevent it, on the most common CV skills there are.
 *
 * Both `Java` articles pass once the qualifier is stripped, which is correct: choosing
 * between the island and the language is exactly the judgement gate 2 is for.
 */
function withoutQualifier(identity: string): string {
  return identity.replace(/\s*\([^()]*\)\s*$/, '');
}

/**
 * Gate 1 — deterministic and free.
 *
 * A prefix relationship is enough (`traefik` against `traefikproxy`, `expressjs` against
 * `expressjscom`), but only when the shorter name is at least half the longer one.
 * Without the ratio, a short skill would match anything starting with those letters.
 *
 * The identity is tried both as given and with a trailing qualifier stripped, so a
 * disambiguated title is judged on its name rather than on Wikipedia's bookkeeping.
 */
export function nameMatches(skill: string, identity: string): boolean {
  const a = normalize(skill);
  if (a.length === 0) return false;

  return [identity, withoutQualifier(identity)].some((form) => {
    const b = normalize(form);
    if (b.length === 0) return false;
    if (a === b) return true;

    const [shorter, longer] = a.length <= b.length ? [a, b] : [b, a];
    if (shorter.length < MIN_STEM) return false;
    if (!longer.startsWith(shorter)) return false;
    return shorter.length / longer.length >= MIN_OVERLAP_RATIO;
  });
}

export function applyNameGate(
  skill: string,
  candidates: readonly Candidate[],
): readonly Candidate[] {
  return candidates.filter((candidate) => nameMatches(skill, candidate.identity));
}

/**
 * **`reason` comes first, and the order is load-bearing.**
 *
 * Grammar-constrained decoding emits fields in schema order, and `think: false` leaves the
 * model no scratchpad. With `index` first, the model had to commit to a number before it
 * had written a word of justification — so it picked one, and then wrote a `reason` that
 * contradicted it: "The candidate describes the Tauri as an ancient people, not the
 * technology" alongside `index: 0`.
 *
 * Measured on the same four cases (`npm run eval`): 1/4 with `index` first, 3/4 with
 * `reason` first, and both refusal cases went from wrong to right. Justifying before
 * committing is the whole difference, and it costs nothing
 * ([ADR-0002](../../../docs/architecture/adr/0002-constrained-decoding.md), correction).
 *
 * **`verdicts` comes before both, for the same reason one step further out.** Reasoning
 * before committing was not enough on its own: measured live against six programming
 * languages, the model spent `reason` describing how it *would* evaluate the candidates —
 * "I need to be strict about what counts as the technology itself" — and then emitted
 * `null` having evaluated none of them. It refused candidate sets containing
 * `Java (programming language)`, `TypeScript` and `rust-lang/rust`.
 *
 * The one case that enumerated candidates one by one reached a correct, defensible answer.
 * So the enumeration is now a field: one verdict per candidate, before any conclusion.
 * A free-text field invites preamble; an array of the same length as the input does not.
 */
const ResolutionSchema = structured(
  'resolve-source',
  z.object({
    verdicts: z.array(z.string()),
    reason: z.string(),
    index: z.number().int().nullable(),
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

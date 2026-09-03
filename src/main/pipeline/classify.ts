import { appError, err, ok, type Result } from '@shared/result';
import { z } from 'zod';
import type { LlmAdapter } from '../llm/adapter';
import { CLASSIFY_SKILL, SYSTEM_PREAMBLE, render } from '../llm/prompts';
import { structured } from '../llm/schema';

/**
 * Assigns the category and tags the skill graph is built from.
 *
 * This runs after synthesis rather than before, because the model classifies far more
 * reliably from retrieved text than from a bare name — "Zustand" alone is a German noun.
 */

export const CATEGORIES = [
  'web-server',
  'database',
  'language',
  'framework',
  'build-tool',
  'testing',
  'platform',
  'devops',
  'protocol',
  'concept',
  'other',
] as const;

export type Category = (typeof CATEGORIES)[number];

const MIN_TAGS = 2;
const MAX_TAGS = 5;

const ClassificationSchema = structured(
  'classify-skill',
  z.object({
    category: z.enum(CATEGORIES),
    tags: z.array(z.string()),
    confidence: z.enum(['high', 'medium', 'low']),
  }),
);

export interface Classification {
  readonly category: Category;
  readonly tags: readonly string[];
  readonly confidence: 'high' | 'medium' | 'low';
}

/** Lowercase and hyphenated, so overlap is a set comparison rather than a fuzzy match. */
function normalizeTag(tag: string): string {
  return tag
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** Tags this generic separate nothing, and would relate every skill to every other. */
const USELESS_TAGS = new Set([
  'software',
  'tool',
  'tools',
  'library',
  'technology',
  'program',
  'application',
  'app',
  'code',
  'development',
  'open-source',
]);

/**
 * `skill` is excluded because a tag equal to the thing being tagged carries no
 * information: "postgresql" on PostgreSQL separates it from nothing, and observed live it
 * was the *only* tag the model returned when the source was an Ansible role.
 */
export function cleanTags(raw: readonly string[], skill = ''): readonly string[] {
  const self = normalizeTag(skill);
  const seen = new Set<string>();
  for (const tag of raw) {
    const normalized = normalizeTag(tag);
    if (normalized.length < 2 || USELESS_TAGS.has(normalized) || normalized === self) continue;
    seen.add(normalized);
    if (seen.size >= MAX_TAGS) break;
  }
  return [...seen];
}

export interface ClassifyDeps {
  readonly llm: LlmAdapter;
}

export async function classifySkill(
  skill: string,
  material: string,
  deps: ClassifyDeps,
  signal?: AbortSignal,
): Promise<Result<Classification>> {
  const generation = await deps.llm.generate({
    system: SYSTEM_PREAMBLE,
    prompt: render(CLASSIFY_SKILL, { SKILL: skill, MATERIAL: material }),
    schema: ClassificationSchema,
    ...(signal ? { signal } : {}),
  });
  if (!generation.ok) return generation;

  const { category, confidence } = generation.value.value;
  const tags = cleanTags(generation.value.value.tags, skill);

  // Too few usable tags leaves nothing to separate near neighbours with, so the skill
  // would relate to everything in its category or nothing at all. Better to fail and
  // retry than to build a graph on it.
  if (tags.length < MIN_TAGS) {
    return err(
      appError(
        'validation',
        'too-few-tags',
        `classification produced ${tags.length} usable tags, below the ${MIN_TAGS} minimum`,
      ),
    );
  }

  return ok({ category, tags, confidence });
}

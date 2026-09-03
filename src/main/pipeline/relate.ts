/**
 * The skill graph — the part of the product nothing else offers.
 *
 * Deliberately pure: no database, no clock, no model. The graph decides which pairs earn
 * a comparison card, and a wrong edge produces a card comparing two unrelated things, so
 * this is worth being able to test exhaustively.
 *
 * The heuristic is tag overlap, not meaning ([TD-03](../../../docs/project/tech-debt.md)).
 * Embeddings are the upgrade path if flag data shows the pairing is what fails.
 */

export type RelationKind = 'same-category' | 'tag-overlap';

export interface Classified {
  readonly id: number;
  readonly category: string | null;
  readonly tags: readonly string[];
}

export interface Relation {
  /** Stored with `a < b`, so each pair exists once regardless of who was added first. */
  readonly skillAId: number;
  readonly skillBId: number;
  readonly kind: RelationKind;
  readonly strength: number;
}

/** Overlap as a fraction of everything either one is tagged with. */
export function tagSimilarity(a: readonly string[], b: readonly string[]): number {
  if (a.length === 0 || b.length === 0) return 0;
  const left = new Set(a);
  const right = new Set(b);
  let shared = 0;
  for (const tag of left) if (right.has(tag)) shared += 1;
  const union = left.size + right.size - shared;
  return union === 0 ? 0 : shared / union;
}

/**
 * A shared category is already strong evidence of comparability, so it starts at 0.5 and
 * tag overlap raises it. Skills in different categories need real overlap before they
 * count as related at all — otherwise every "platform" would relate to every "devops".
 */
const CROSS_CATEGORY_MIN = 0.34;

/** Below this a pair is related but not interesting enough to spend a card on. */
export const COMPARISON_THRESHOLD = 0.6;

export function relate(a: Classified, b: Classified): Relation | null {
  if (a.id === b.id) return null;
  if (!a.category || !b.category) return null;

  const similarity = tagSimilarity(a.tags, b.tags);
  const [low, high] = a.id < b.id ? [a.id, b.id] : [b.id, a.id];

  if (a.category === b.category) {
    return {
      skillAId: low,
      skillBId: high,
      kind: 'same-category',
      strength: 0.5 + 0.5 * similarity,
    };
  }

  if (similarity >= CROSS_CATEGORY_MIN) {
    return { skillAId: low, skillBId: high, kind: 'tag-overlap', strength: similarity };
  }

  return null;
}

/** Every relation between one skill and the rest. Recomputed when a skill changes. */
export function relationsFor(
  skill: Classified,
  others: readonly Classified[],
): readonly Relation[] {
  return others
    .map((other) => relate(skill, other))
    .filter((relation): relation is Relation => relation !== null);
}

export function earnsComparison(relation: Relation): boolean {
  return relation.strength >= COMPARISON_THRESHOLD;
}

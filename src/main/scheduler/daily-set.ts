import type { ItemType } from '@shared/domain';

/**
 * Daily-set assembly — deterministic, pure, and deliberately dumb.
 *
 * "Dumb" on purpose: sorting due items by how overdue they are, and choosing which new
 * items go first, are SQL's job (`ReviewsRepository` orders its queries), not this
 * function's. This only knows how to cap and fill, which is the part worth testing in
 * isolation ([system-design.md](../../../docs/architecture/system-design.md)).
 *
 * Cards and questions are capped independently against the user's two separate counts
 * (FR-40): a skill list heavy on cards must not crowd out the day's questions, or the
 * other way round.
 */

export interface CandidateItem {
  readonly itemType: ItemType;
  readonly itemId: number;
  /** Which skill it belongs to — what the round-robin spreads across. */
  readonly skillId: number;
}

/** A per-skill cap on how much one skill may contribute today. Absent means no cap. */
export type SkillLimits = ReadonlyMap<number, number | null>;

export interface AssembledItem extends CandidateItem {
  /** Assembly order — stable once written, so a reopened set renders identically. */
  readonly position: number;
}

export interface DailySetCounts {
  readonly cards: number;
  readonly questions: number;
}

export interface DailySetLimits {
  readonly cards: SkillLimits;
  readonly questions: SkillLimits;
}

export interface DailySetPool {
  /** Pre-sorted by the caller, most overdue first. */
  readonly dueCards: readonly CandidateItem[];
  /** Pre-sorted by the caller's priority order; this function does not choose among them. */
  readonly newCards: readonly CandidateItem[];
  readonly dueQuestions: readonly CandidateItem[];
  readonly newQuestions: readonly CandidateItem[];
}

/**
 * Cards first, then questions — an arbitrary but stable choice, since nothing in the spec
 * requires interleaving. Within each, due items before new ones: a backlog is reviewed
 * before it grows, and days-old due items past the cap are left due rather than dropped
 * (FR-42's "capped at the configured count; the rest stays due").
 *
 * An empty pool produces an empty set. There is no filler path to accidentally trigger —
 * "nothing due and no new content" is the input producing no output, not a special case.
 */
export function assembleDailySet(
  pool: DailySetPool,
  counts: DailySetCounts,
  limits?: DailySetLimits,
): readonly AssembledItem[] {
  const cards = takeUpTo(pool.dueCards, pool.newCards, counts.cards, limits?.cards);
  const questions = takeUpTo(
    pool.dueQuestions,
    pool.newQuestions,
    counts.questions,
    limits?.questions,
  );
  return [...cards, ...questions].map((item, position) => ({ ...item, position }));
}

/**
 * Fills the cap, taking **one item per skill before a second from any of them**.
 *
 * Without this the pool is consumed in order, and order is id order — so the skills added
 * first fill the whole day and the newest one is never seen at all. Four skills and four
 * cards should be one card each, which is both fairer and a better day's reading: four
 * subjects touched beats two subjects twice.
 *
 * Due items still come before new ones, and the round-robin runs inside each of those two
 * groups rather than across them. A backlog is still reviewed before it grows; it is only
 * *which* overdue items get today's slots that this changes.
 *
 * A per-skill cap is honoured throughout, and applies to due and new items together — it
 * is a limit on what the day holds from that skill, not on where it came from.
 */
function takeUpTo(
  due: readonly CandidateItem[],
  fresh: readonly CandidateItem[],
  cap: number,
  limits?: SkillLimits,
): readonly CandidateItem[] {
  if (cap <= 0) return [];

  const taken: CandidateItem[] = [];
  const perSkill = new Map<number, number>();

  for (const group of [due, fresh]) {
    for (const item of spread(group)) {
      if (taken.length >= cap) return taken;

      // Checked here rather than while the rounds are laid out, because the count only
      // moves when something is actually taken. Consulting it during layout reads zero
      // every time and the cap never fires — which is what the first version did, and a
      // test caught. Skipping rather than stopping is what hands the slot to another skill.
      const limit = limits?.get(item.skillId);
      const soFar = perSkill.get(item.skillId) ?? 0;
      if (limit !== undefined && limit !== null && soFar >= limit) continue;

      taken.push(item);
      perSkill.set(item.skillId, soFar + 1);
    }
  }
  return taken;
}

/**
 * Re-orders one group so that skills alternate: every skill's first item, then every
 * skill's second, and so on. Order within a skill is preserved, so the caller's sort —
 * most overdue first — still decides which of that skill's items comes up.
 */
function spread(items: readonly CandidateItem[]): readonly CandidateItem[] {
  const bySkill = new Map<number, CandidateItem[]>();
  for (const item of items) {
    const existing = bySkill.get(item.skillId);
    if (existing) existing.push(item);
    else bySkill.set(item.skillId, [item]);
  }

  const ordered: CandidateItem[] = [];
  const queues = [...bySkill.values()];
  let round = 0;
  let anyLeft = true;

  while (anyLeft) {
    anyLeft = false;
    for (const queue of queues) {
      const item = queue[round];
      if (!item) continue;
      anyLeft = true;
      ordered.push(item);
    }
    round += 1;
  }
  return ordered;
}

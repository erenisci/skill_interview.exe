import type { Db } from '../index';
import type { Classified, Relation, RelationKind } from '../../pipeline/relate';

interface RelationRow {
  skill_a_id: number;
  skill_b_id: number;
  kind: string;
  strength: number;
}

interface ClassifiedRow {
  id: number;
  category: string | null;
  tags: string;
}

function toRelation(row: RelationRow): Relation {
  return {
    skillAId: row.skill_a_id,
    skillBId: row.skill_b_id,
    kind: row.kind as RelationKind,
    strength: row.strength,
  };
}

function parseTags(raw: string): readonly string[] {
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((t): t is string => typeof t === 'string') : [];
  } catch {
    return [];
  }
}

export class RelationsRepository {
  constructor(private readonly db: Db) {}

  /** Everything the graph needs and nothing it does not — id, category, tags. */
  classifiedSkills(exceptId?: number): readonly Classified[] {
    const rows = this.db
      .prepare(
        `SELECT id, category, tags FROM skills
         WHERE category IS NOT NULL AND (@exceptId IS NULL OR id != @exceptId)`,
      )
      .all({ exceptId: exceptId ?? null }) as ClassifiedRow[];
    return rows.map((row) => ({ id: row.id, category: row.category, tags: parseTags(row.tags) }));
  }

  /**
   * Replaces every relation touching this skill, in one transaction.
   *
   * Recomputation rather than incremental patching: a reclassified skill invalidates its
   * old edges, and deleting-then-inserting is easier to reason about than working out
   * which ones changed.
   */
  replaceFor(skillId: number, relations: readonly Relation[]): void {
    const write = this.db.transaction(() => {
      this.db
        .prepare('DELETE FROM skill_relations WHERE skill_a_id = ? OR skill_b_id = ?')
        .run(skillId, skillId);
      const insert = this.db.prepare(
        `INSERT INTO skill_relations (skill_a_id, skill_b_id, kind, strength)
         VALUES (@skillAId, @skillBId, @kind, @strength)`,
      );
      for (const relation of relations) insert.run(relation);
    });
    write();
  }

  listFor(skillId: number): readonly Relation[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM skill_relations WHERE skill_a_id = ? OR skill_b_id = ?
         ORDER BY strength DESC`,
      )
      .all(skillId, skillId) as RelationRow[];
    return rows.map(toRelation);
  }

  /** The other end of a relation, whichever column this skill sits in. */
  static otherSide(relation: Relation, skillId: number): number {
    return relation.skillAId === skillId ? relation.skillBId : relation.skillAId;
  }

  exists(a: number, b: number): boolean {
    const [low, high] = a < b ? [a, b] : [b, a];
    const row = this.db
      .prepare('SELECT 1 AS present FROM skill_relations WHERE skill_a_id = ? AND skill_b_id = ?')
      .get(low, high) as { present: number } | undefined;
    return row !== undefined;
  }
}

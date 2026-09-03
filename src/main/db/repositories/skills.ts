import type { Db } from '../index';
import type { ContentLanguage, Skill, SkillStatus } from '@shared/domain';

/** The raw shape SQLite hands back. Mapped to the domain type before it leaves this file. */
interface SkillRow {
  id: number;
  name: string;
  slug: string;
  category: string | null;
  tags: string;
  status: string;
  content_lang: string;
  created_at: string;
}

function toSkill(row: SkillRow): Skill {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    category: row.category,
    tags: parseTags(row.tags),
    status: row.status as SkillStatus,
    contentLang: row.content_lang as ContentLanguage,
    createdAt: row.created_at,
  };
}

/** `tags` is a JSON column: untrusted at the boundary even though we wrote it. */
function parseTags(raw: string): readonly string[] {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((t): t is string => typeof t === 'string');
  } catch {
    return [];
  }
}

export class SkillsRepository {
  constructor(private readonly db: Db) {}

  list(): readonly Skill[] {
    const rows = this.db
      .prepare('SELECT * FROM skills ORDER BY created_at DESC, id DESC')
      .all() as SkillRow[];
    return rows.map(toSkill);
  }

  findBySlug(slug: string): Skill | null {
    const row = this.db.prepare('SELECT * FROM skills WHERE slug = ?').get(slug) as
      SkillRow | undefined;
    return row ? toSkill(row) : null;
  }

  findById(id: number): Skill | null {
    const row = this.db.prepare('SELECT * FROM skills WHERE id = ?').get(id) as
      SkillRow | undefined;
    return row ? toSkill(row) : null;
  }

  insert(input: {
    name: string;
    slug: string;
    contentLang: ContentLanguage;
    createdAt: string;
  }): Skill {
    const info = this.db
      .prepare(
        `INSERT INTO skills (name, slug, tags, status, content_lang, created_at)
         VALUES (@name, @slug, '[]', 'pending', @contentLang, @createdAt)`,
      )
      .run(input);
    const created = this.findById(Number(info.lastInsertRowid));
    if (!created) throw new Error('skill insert did not produce a row');
    return created;
  }

  setStatus(id: number, status: SkillStatus): void {
    this.db.prepare('UPDATE skills SET status = ? WHERE id = ?').run(status, id);
  }

  setClassification(id: number, category: string, tags: readonly string[]): void {
    this.db
      .prepare('UPDATE skills SET category = ?, tags = ? WHERE id = ?')
      .run(category, JSON.stringify(tags), id);
  }

  remove(id: number): boolean {
    return this.db.prepare('DELETE FROM skills WHERE id = ?').run(id).changes > 0;
  }
}

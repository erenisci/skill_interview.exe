import type { Db } from '../index';
import type { Card, CardType, ContentLanguage, Source } from '@shared/domain';

interface SourceRow {
  id: number;
  skill_id: number;
  url: string;
  title: string;
  publisher: string | null;
  license: string | null;
  fetched_at: string;
  excerpt: string;
}

interface CardRow {
  id: number;
  skill_id: number;
  related_skill_id: number | null;
  type: string;
  title: string;
  body_md: string;
  content_lang: string;
  model: string;
  prompt_version: string;
  created_at: string;
}

function toSource(row: SourceRow): Source {
  return {
    id: row.id,
    skillId: row.skill_id,
    url: row.url,
    title: row.title,
    publisher: row.publisher,
    license: row.license,
    fetchedAt: row.fetched_at,
    excerpt: row.excerpt,
  };
}

function toCard(row: CardRow): Card {
  return {
    id: row.id,
    skillId: row.skill_id,
    relatedSkillId: row.related_skill_id,
    type: row.type as CardType,
    title: row.title,
    bodyMd: row.body_md,
    contentLang: row.content_lang as ContentLanguage,
    model: row.model,
    promptVersion: row.prompt_version,
    createdAt: row.created_at,
  };
}

export interface NewSource {
  readonly skillId: number;
  readonly url: string;
  readonly title: string;
  readonly publisher: string | null;
  readonly license: string | null;
  readonly fetchedAt: string;
  readonly excerpt: string;
}

export interface NewCard {
  readonly skillId: number;
  readonly relatedSkillId?: number | null;
  readonly type: CardType;
  readonly title: string;
  readonly bodyMd: string;
  readonly contentLang: ContentLanguage;
  readonly model: string;
  readonly promptVersion: string;
  readonly createdAt: string;
}

export class CardsRepository {
  constructor(private readonly db: Db) {}

  /**
   * Writes a card **and** its sources in one transaction.
   *
   * There is deliberately no way to insert a card on its own. "A card without provenance
   * is a bug" is an invariant the schema cannot express, so the API refuses to make it
   * expressible: either both land or neither does
   * ([database-design.md](../../../../docs/architecture/database-design.md)).
   */
  insertWithSources(card: NewCard, sources: readonly NewSource[]): Card {
    if (sources.length === 0) {
      throw new Error('a card must be written with at least one source');
    }

    const write = this.db.transaction((): number => {
      const cardId = Number(
        this.db
          .prepare(
            `INSERT INTO cards
               (skill_id, related_skill_id, type, title, body_md, content_lang, model, prompt_version, created_at)
             VALUES (@skillId, @relatedSkillId, @type, @title, @bodyMd, @contentLang, @model, @promptVersion, @createdAt)`,
          )
          .run({ ...card, relatedSkillId: card.relatedSkillId ?? null }).lastInsertRowid,
      );

      const insertSource = this.db.prepare(
        `INSERT INTO sources (skill_id, url, title, publisher, license, fetched_at, excerpt)
         VALUES (@skillId, @url, @title, @publisher, @license, @fetchedAt, @excerpt)`,
      );
      const link = this.db.prepare('INSERT INTO card_sources (card_id, source_id) VALUES (?, ?)');

      for (const source of sources) {
        const sourceId = insertSource.run(source).lastInsertRowid;
        link.run(cardId, sourceId);
      }
      return cardId;
    });

    const id = write();
    const created = this.findById(id);
    if (!created) throw new Error('card insert did not produce a row');
    return created;
  }

  findById(id: number): Card | null {
    const row = this.db.prepare('SELECT * FROM cards WHERE id = ?').get(id) as CardRow | undefined;
    return row ? toCard(row) : null;
  }

  listBySkill(skillId: number): readonly Card[] {
    const rows = this.db
      .prepare('SELECT * FROM cards WHERE skill_id = ? ORDER BY created_at DESC, id DESC')
      .all(skillId) as CardRow[];
    return rows.map(toCard);
  }

  /** Every card shows these; the product requires it rather than offering it (FR-12). */
  sourcesFor(cardId: number): readonly Source[] {
    const rows = this.db
      .prepare(
        `SELECT s.* FROM sources s
         JOIN card_sources cs ON cs.source_id = s.id
         WHERE cs.card_id = ?
         ORDER BY s.id ASC`,
      )
      .all(cardId) as SourceRow[];
    return rows.map(toSource);
  }
}

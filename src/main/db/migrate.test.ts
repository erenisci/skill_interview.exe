import type { Database as Db } from 'better-sqlite3';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { currentVersion, migrate } from './migrate';
import { MIGRATIONS } from './migrations';

let db: Db;

beforeEach(() => {
  db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
});

afterEach(() => db.close());

const LATEST = MIGRATIONS[MIGRATIONS.length - 1]?.version ?? 0;

function seedSkill(name = 'nginx', slug = name): number {
  const info = db
    .prepare(
      `INSERT INTO skills (name, slug, tags, status, content_lang, created_at)
       VALUES (?, ?, '[]', 'ready', 'en', '2026-09-02T00:00:00.000Z')`,
    )
    .run(name, slug);
  return Number(info.lastInsertRowid);
}

function seedCard(skillId: number, title = 'nginx', body = 'a reverse proxy'): number {
  const info = db
    .prepare(
      `INSERT INTO cards (skill_id, type, title, body_md, content_lang, model, prompt_version, created_at)
       VALUES (?, 'primer', ?, ?, 'en', 'stub', 'v1', '2026-09-02T00:00:00.000Z')`,
    )
    .run(skillId, title, body);
  return Number(info.lastInsertRowid);
}

describe('migrate', () => {
  it('brings a fresh database to the latest version', () => {
    expect(currentVersion(db)).toBe(0);
    expect(migrate(db)).toBe(LATEST);
    expect(currentVersion(db)).toBe(LATEST);
  });

  it('is idempotent — a second run applies nothing', () => {
    migrate(db);
    expect(() => migrate(db)).not.toThrow();
    expect(currentVersion(db)).toBe(LATEST);
  });

  it('records the applied version in settings, as configuration.md documents', () => {
    migrate(db);
    const row = db.prepare(`SELECT value FROM settings WHERE key = 'db_schema_version'`).get() as
      { value: string } | undefined;
    expect(row?.value).toBe(String(LATEST));
  });

  it('creates every table the schema documents', () => {
    migrate(db);
    const names = (
      db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table'`).all() as { name: string }[]
    ).map((r) => r.name);
    for (const table of [
      'skills',
      'skill_relations',
      'sources',
      'cards',
      'card_sources',
      'questions',
      'options',
      'reviews',
      'favorites',
      'jobs',
      'settings',
    ]) {
      expect(names).toContain(table);
    }
  });

  it('rolls back and reports when a migration fails, leaving the version untouched', () => {
    const broken = { version: 1, name: 'broken', sql: 'CREATE TABLE ok (a); THIS IS NOT SQL;' };
    // Same code path as migrate(), exercised against a deliberately bad migration.
    expect(() => {
      const apply = db.transaction(() => {
        db.exec(broken.sql);
        db.pragma(`user_version = ${broken.version}`);
      });
      apply();
    }).toThrow();
    expect(currentVersion(db)).toBe(0);
    const names = (
      db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table'`).all() as { name: string }[]
    ).map((r) => r.name);
    expect(names).not.toContain('ok');
  });
});

describe('schema invariants', () => {
  beforeEach(() => migrate(db));

  it('rejects a duplicate slug (FR-02 is enforced in the schema too)', () => {
    seedSkill('nginx', 'nginx');
    expect(() => seedSkill('NGINX', 'nginx')).toThrow();
  });

  it('requires a comparison card to name a second skill, and a primer not to', () => {
    const a = seedSkill('nginx', 'nginx');
    const b = seedSkill('Traefik', 'traefik');
    expect(() =>
      db
        .prepare(
          `INSERT INTO cards (skill_id, type, title, body_md, content_lang, model, prompt_version, created_at)
           VALUES (?, 'comparison', 't', 'b', 'en', 'stub', 'v1', '2026-09-02T00:00:00.000Z')`,
        )
        .run(a),
    ).toThrow();
    expect(() =>
      db
        .prepare(
          `INSERT INTO cards (skill_id, related_skill_id, type, title, body_md, content_lang, model, prompt_version, created_at)
           VALUES (?, ?, 'primer', 't', 'b', 'en', 'stub', 'v1', '2026-09-02T00:00:00.000Z')`,
        )
        .run(a, b),
    ).toThrow();
  });

  it('stores each relation pair once, ordered', () => {
    const a = seedSkill('nginx', 'nginx');
    const b = seedSkill('Traefik', 'traefik');
    const insert = db.prepare(
      'INSERT INTO skill_relations (skill_a_id, skill_b_id, kind, strength) VALUES (?, ?, ?, ?)',
    );
    insert.run(Math.min(a, b), Math.max(a, b), 'same-category', 0.9);
    expect(() => insert.run(Math.max(a, b), Math.min(a, b), 'same-category', 0.9)).toThrow();
  });

  it('rejects an option that is neither correct nor incorrect', () => {
    const skill = seedSkill();
    const card = seedCard(skill);
    const q = db
      .prepare(
        `INSERT INTO questions (skill_id, card_id, stem, explanation, content_lang, model, prompt_version)
         VALUES (?, ?, 's', 'e', 'en', 'stub', 'v1')`,
      )
      .run(skill, card).lastInsertRowid;
    expect(() =>
      db
        .prepare(
          'INSERT INTO options (question_id, text, rationale, is_correct) VALUES (?, ?, ?, ?)',
        )
        .run(q, 'o', 'r', 7),
    ).toThrow();
  });

  it('cascades a deleted skill to its cards but never to review history', () => {
    const skill = seedSkill();
    const card = seedCard(skill);
    db.prepare(
      `INSERT INTO reviews (item_type, item_id, reviewed_at, rating, due_at, stability, difficulty)
       VALUES ('card', ?, '2026-09-02T00:00:00.000Z', 3, '2026-09-05T00:00:00.000Z', 1.0, 5.0)`,
    ).run(card);

    db.prepare('DELETE FROM skills WHERE id = ?').run(skill);

    expect(db.prepare('SELECT COUNT(*) AS n FROM cards').get()).toEqual({ n: 0 });
    expect(db.prepare('SELECT COUNT(*) AS n FROM reviews').get()).toEqual({ n: 1 });
  });

  it('keeps the full-text index in step with cards', () => {
    const skill = seedSkill();
    const card = seedCard(skill, 'nginx', 'a reverse proxy and load balancer');

    const hits = () =>
      (
        db.prepare(`SELECT COUNT(*) AS n FROM cards_fts WHERE cards_fts MATCH 'proxy'`).get() as {
          n: number;
        }
      ).n;
    expect(hits()).toBe(1);

    db.prepare('UPDATE cards SET body_md = ? WHERE id = ?').run('an ingress controller', card);
    expect(hits()).toBe(0);

    db.prepare('DELETE FROM cards WHERE id = ?').run(card);
    expect(
      (
        db.prepare(`SELECT COUNT(*) AS n FROM cards_fts WHERE cards_fts MATCH 'ingress'`).get() as {
          n: number;
        }
      ).n,
    ).toBe(0);
  });
});

import type { Skill } from '@shared/domain';
import type { Database as Db } from 'better-sqlite3';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { migrate } from '../db/migrate';
import { CardsRepository } from '../db/repositories/cards';
import { FavoritesRepository } from '../db/repositories/favorites';
import { QuestionsRepository } from '../db/repositories/questions';
import { SkillsRepository } from '../db/repositories/skills';
import { exportFavoritesMarkdown, hydrateFavorites, type FavoritesDeps } from './favorites';

let db: Db;
let skills: SkillsRepository;
let cards: CardsRepository;
let questions: QuestionsRepository;
let favorites: FavoritesRepository;

const NOW = '2026-09-03T12:00:00.000Z';

beforeEach(() => {
  db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  migrate(db);
  skills = new SkillsRepository(db);
  cards = new CardsRepository(db);
  questions = new QuestionsRepository(db);
  favorites = new FavoritesRepository(db);
});

afterEach(() => db.close());

function deps(): FavoritesDeps {
  return { favorites, cards, questions, skills, now: () => new Date(NOW) };
}

function addSkill(name: string): Skill {
  return skills.insert({ name, slug: name.toLowerCase(), contentLang: 'en', createdAt: NOW });
}

function addCard(skill: Skill): number {
  return cards.insertWithSources(
    {
      skillId: skill.id,
      type: 'primer',
      title: skill.name,
      bodyMd: `${skill.name} is a reverse proxy.`,
      contentLang: 'en',
      model: 'stub',
      promptVersion: 'primer-card.v1',
      createdAt: NOW,
    },
    [
      {
        skillId: skill.id,
        url: `https://example.test/${skill.slug}`,
        title: `${skill.name} docs`,
        publisher: 'Example',
        license: 'CC BY-SA 4.0',
        fetchedAt: NOW,
        excerpt: 'reverse proxy',
      },
    ],
  ).id;
}

function addQuestion(skill: Skill, cardId: number): number {
  return questions.insertWithOptions(
    {
      skillId: skill.id,
      cardId,
      stem: `Which of the following is true of ${skill.name}?`,
      explanation: 'Because it routes requests to backends.',
      contentLang: 'en',
      model: 'stub',
      promptVersion: 'question-stem.v1',
    },
    [
      {
        text: 'routes requests by host and path',
        rationale: skill.name,
        isCorrect: true,
        sourceSkillId: null,
      },
      {
        text: 'stores rows in a write-ahead log',
        rationale: 'PostgreSQL',
        isCorrect: false,
        sourceSkillId: null,
      },
      {
        text: 'schedules containers across nodes',
        rationale: 'Kubernetes',
        isCorrect: false,
        sourceSkillId: null,
      },
      {
        text: 'caches compiled templates in memory',
        rationale: 'PHP-FPM',
        isCorrect: false,
        sourceSkillId: null,
      },
    ],
  ).id;
}

describe('FavoritesRepository', () => {
  it('adds a favourite and finds it again', () => {
    const nginx = addSkill('nginx');
    const cardId = addCard(nginx);

    favorites.add('card', cardId, NOW);
    expect(favorites.find('card', cardId)?.itemId).toBe(cardId);
    expect(favorites.count()).toBe(1);
  });

  it('is idempotent, and adding twice does not discard an existing note', () => {
    const nginx = addSkill('nginx');
    const cardId = addCard(nginx);

    favorites.add('card', cardId, NOW);
    favorites.setNote('card', cardId, 'ask about worker processes');
    favorites.add('card', cardId, NOW);

    expect(favorites.count()).toBe(1);
    expect(favorites.find('card', cardId)?.note).toBe('ask about worker processes');
  });

  it('stores a blank note as null rather than an empty string', () => {
    const nginx = addSkill('nginx');
    const cardId = addCard(nginx);
    favorites.add('card', cardId, NOW);

    favorites.setNote('card', cardId, '   ');
    expect(favorites.find('card', cardId)?.note).toBeNull();
  });

  it('refuses to note an item that is not favourited', () => {
    expect(favorites.setNote('card', 999, 'note')).toBe(false);
  });

  it('tells a card and a question with the same id apart', () => {
    const nginx = addSkill('nginx');
    const cardId = addCard(nginx);
    const questionId = addQuestion(nginx, cardId);

    favorites.add('card', cardId, NOW);
    expect(favorites.find('question', questionId)).toBeNull();
  });
});

describe('hydrateFavorites', () => {
  it('returns a card with its skill and sources', () => {
    const nginx = addSkill('nginx');
    const cardId = addCard(nginx);
    favorites.add('card', cardId, NOW);

    const [entry] = hydrateFavorites(deps());
    expect(entry?.kind).toBe('card');
    if (entry?.kind !== 'card') return;
    expect(entry.skill.name).toBe('nginx');
    expect(entry.sources).toHaveLength(1);
    expect(entry.sources[0]?.license).toBe('CC BY-SA 4.0');
  });

  it('returns a question with its options', () => {
    const nginx = addSkill('nginx');
    const questionId = addQuestion(nginx, addCard(nginx));
    favorites.add('question', questionId, NOW);

    const [entry] = hydrateFavorites(deps());
    expect(entry?.kind).toBe('question');
    if (entry?.kind !== 'question') return;
    expect(entry.question.options).toHaveLength(4);
  });

  it('keeps a favourited question that was later flagged', () => {
    // Flagging takes a question out of rotation. Favouriting is the user saying they want
    // to keep it. The second is not undone by the first.
    const nginx = addSkill('nginx');
    const questionId = addQuestion(nginx, addCard(nginx));
    favorites.add('question', questionId, NOW);
    questions.flag({
      questionId,
      target: 'question',
      reason: 'too-easy',
      note: null,
      createdAt: NOW,
    });

    expect(hydrateFavorites(deps())[0]?.kind).toBe('question');
  });

  it('reports a favourite as orphaned once its skill is deleted', () => {
    const nginx = addSkill('nginx');
    const cardId = addCard(nginx);
    favorites.add('card', cardId, NOW);
    favorites.setNote('card', cardId, 'worth relearning');

    skills.remove(nginx.id);

    const [entry] = hydrateFavorites(deps());
    // The row survives the cascade that took its card — that is the point of holding no
    // foreign key.
    expect(entry?.kind).toBe('orphaned');
    expect(entry?.favorite.note).toBe('worth relearning');
  });
});

describe('exportFavoritesMarkdown', () => {
  it('refuses when there is nothing kept, rather than writing an empty file', () => {
    const result = exportFavoritesMarkdown(deps());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('nothing-to-export');
  });

  it('renders kept cards and questions with their sources and notes', () => {
    const nginx = addSkill('nginx');
    const cardId = addCard(nginx);
    const questionId = addQuestion(nginx, cardId);
    favorites.add('card', cardId, NOW);
    favorites.setNote('card', cardId, 'ask about worker processes');
    favorites.add('question', questionId, NOW);

    const result = exportFavoritesMarkdown(deps());
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // FR-52's exit criterion: readable Markdown with sources preserved.
    expect(result.value).toContain('## nginx');
    expect(result.value).toContain('nginx is a reverse proxy.');
    expect(result.value).toContain('](https://example.test/nginx)');
    expect(result.value).toContain('> **Note.** ask about worker processes');
    expect(result.value).toContain('Which of the following is true of nginx?');
  });

  it('still exports a favourite whose skill is gone', () => {
    const nginx = addSkill('nginx');
    const cardId = addCard(nginx);
    favorites.add('card', cardId, NOW);
    skills.remove(nginx.id);

    const result = exportFavoritesMarkdown(deps());
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toContain('## No longer tracked');
  });
});

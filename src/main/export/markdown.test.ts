import type { Card, Favorite, Question, Skill, Source } from '@shared/domain';
import { describe, expect, it } from 'vitest';
import type { FavoriteEntry } from '@shared/ipc';
import { renderFavoritesMarkdown } from './markdown';

const EXPORTED_AT = new Date('2026-09-03T12:00:00.000Z');

function skill(id: number, name: string): Skill {
  return {
    id,
    name,
    slug: name.toLowerCase(),
    category: 'web-server',
    tags: [],
    status: 'ready',
    contentLang: 'en',
    createdAt: '2026-09-01T00:00:00.000Z',
  };
}

function favorite(overrides: Partial<Favorite> = {}): Favorite {
  return {
    id: 1,
    itemType: 'card',
    itemId: 1,
    note: null,
    createdAt: '2026-09-02T09:00:00.000Z',
    ...overrides,
  };
}

function card(overrides: Partial<Card> = {}): Card {
  return {
    id: 1,
    skillId: 1,
    relatedSkillId: null,
    type: 'primer',
    title: 'nginx',
    bodyMd: 'nginx is a reverse proxy.',
    contentLang: 'en',
    model: 'qwen3:4b',
    promptVersion: 'primer-card.v1',
    createdAt: '2026-09-01T00:00:00.000Z',
    ...overrides,
  };
}

function source(overrides: Partial<Source> = {}): Source {
  return {
    id: 1,
    skillId: 1,
    url: 'https://github.com/nginx/nginx',
    title: 'nginx/nginx',
    publisher: 'GitHub',
    license: 'BSD-2-Clause',
    fetchedAt: '2026-09-01T00:00:00.000Z',
    excerpt: 'reverse proxy',
    ...overrides,
  };
}

function question(overrides: Partial<Question> = {}): Question {
  return {
    id: 1,
    skillId: 1,
    cardId: 1,
    stem: 'Which of the following is true of nginx?',
    explanation: 'It routes requests to backends.',
    difficulty: null,
    contentLang: 'en',
    model: 'qwen3:4b',
    promptVersion: 'question-stem.v1',
    status: 'active',
    options: [
      {
        id: 1,
        questionId: 1,
        text: 'uses an asynchronous event-driven approach',
        rationale: 'nginx',
        isCorrect: true,
        sourceSkillId: null,
      },
      {
        id: 2,
        questionId: 1,
        text: 'supports multi-factor stickiness',
        rationale: 'HAProxy',
        isCorrect: false,
        sourceSkillId: 2,
      },
    ],
    ...overrides,
  };
}

describe('renderFavoritesMarkdown — the document a reader gets', () => {
  it('writes a header counting items and skills', () => {
    const entries: FavoriteEntry[] = [
      { kind: 'card', favorite: favorite(), skill: skill(1, 'nginx'), card: card(), sources: [] },
    ];
    const output = renderFavoritesMarkdown(entries, EXPORTED_AT);

    expect(output).toContain('# Favourites');
    expect(output).toContain('on 2026-09-03');
    expect(output).toContain('1 item across 1 skill');
  });

  it('pluralises the count rather than writing "1 items"', () => {
    const entries: FavoriteEntry[] = [
      { kind: 'card', favorite: favorite(), skill: skill(1, 'nginx'), card: card(), sources: [] },
      {
        kind: 'card',
        favorite: favorite({ id: 2, itemId: 2 }),
        skill: skill(2, 'HAProxy'),
        card: card({ id: 2, skillId: 2, title: 'HAProxy' }),
        sources: [],
      },
    ];
    expect(renderFavoritesMarkdown(entries, EXPORTED_AT)).toContain('2 items across 2 skills');
  });

  it('groups entries under their skill, in the order the caller supplied', () => {
    const entries: FavoriteEntry[] = [
      {
        kind: 'card',
        favorite: favorite({ id: 2, itemId: 2 }),
        skill: skill(2, 'HAProxy'),
        card: card({ id: 2, skillId: 2, title: 'HAProxy' }),
        sources: [],
      },
      { kind: 'card', favorite: favorite(), skill: skill(1, 'nginx'), card: card(), sources: [] },
    ];
    const output = renderFavoritesMarkdown(entries, EXPORTED_AT);

    expect(output.indexOf('## HAProxy')).toBeLessThan(output.indexOf('## nginx'));
  });

  it('puts two favourites from one skill under a single heading', () => {
    const entries: FavoriteEntry[] = [
      { kind: 'card', favorite: favorite(), skill: skill(1, 'nginx'), card: card(), sources: [] },
      {
        kind: 'question',
        favorite: favorite({ id: 2, itemType: 'question', itemId: 1 }),
        skill: skill(1, 'nginx'),
        question: question(),
      },
    ];
    const output = renderFavoritesMarkdown(entries, EXPORTED_AT);

    expect(output.match(/^## nginx$/gm)).toHaveLength(1);
  });
});

describe('renderFavoritesMarkdown — cards', () => {
  it('keeps the body and links every source with its licence', () => {
    const entries: FavoriteEntry[] = [
      {
        kind: 'card',
        favorite: favorite(),
        skill: skill(1, 'nginx'),
        card: card(),
        sources: [source()],
      },
    ];
    const output = renderFavoritesMarkdown(entries, EXPORTED_AT);

    expect(output).toContain('nginx is a reverse proxy.');
    // FR-52: a source the reader can actually follow, not an id.
    expect(output).toContain('[nginx/nginx](https://github.com/nginx/nginx) (BSD-2-Clause)');
  });

  it('omits the licence when a source has none, rather than writing empty brackets', () => {
    const entries: FavoriteEntry[] = [
      {
        kind: 'card',
        favorite: favorite(),
        skill: skill(1, 'nginx'),
        card: card(),
        sources: [source({ license: null })],
      },
    ];
    expect(renderFavoritesMarkdown(entries, EXPORTED_AT)).toContain(
      '[nginx/nginx](https://github.com/nginx/nginx)\n',
    );
  });

  it('includes the note when there is one', () => {
    const entries: FavoriteEntry[] = [
      {
        kind: 'card',
        favorite: favorite({ note: 'ask about worker processes' }),
        skill: skill(1, 'nginx'),
        card: card(),
        sources: [],
      },
    ];
    expect(renderFavoritesMarkdown(entries, EXPORTED_AT)).toContain(
      '> **Note.** ask about worker processes',
    );
  });

  it('writes no note line at all when there is none', () => {
    const entries: FavoriteEntry[] = [
      { kind: 'card', favorite: favorite(), skill: skill(1, 'nginx'), card: card(), sources: [] },
    ];
    expect(renderFavoritesMarkdown(entries, EXPORTED_AT)).not.toContain('**Note.**');
  });
});

describe('renderFavoritesMarkdown — questions', () => {
  it('marks the correct option and names what each wrong one describes', () => {
    const entries: FavoriteEntry[] = [
      {
        kind: 'question',
        favorite: favorite({ itemType: 'question' }),
        skill: skill(1, 'nginx'),
        question: question(),
      },
    ];
    const output = renderFavoritesMarkdown(entries, EXPORTED_AT);

    expect(output).toContain('- **✓** uses an asynchronous event-driven approach — _nginx_');
    expect(output).toContain('- ☐ supports multi-factor stickiness — _HAProxy_');
    expect(output).toContain('It routes requests to backends.');
  });

  it('escapes a pipe in option text so it cannot break the surrounding document', () => {
    const entries: FavoriteEntry[] = [
      {
        kind: 'question',
        favorite: favorite({ itemType: 'question' }),
        skill: skill(1, 'nginx'),
        question: question({
          options: [
            {
              id: 1,
              questionId: 1,
              text: 'pipes output with a | character',
              rationale: 'nginx',
              isCorrect: true,
              sourceSkillId: null,
            },
          ],
        }),
      },
    ];
    expect(renderFavoritesMarkdown(entries, EXPORTED_AT)).toContain('with a \\| character');
  });
});

describe('renderFavoritesMarkdown — favourites whose skill is gone', () => {
  it('keeps them under their own heading rather than dropping them', () => {
    const entries: FavoriteEntry[] = [
      { kind: 'orphaned', favorite: favorite({ itemType: 'question', itemId: 99 }) },
    ];
    const output = renderFavoritesMarkdown(entries, EXPORTED_AT);

    expect(output).toContain('## No longer tracked');
    expect(output).toContain('A question kept on 2026-09-02');
    expect(output).toContain('has since been removed');
  });

  it("keeps the note on an orphan too — it is the user's own writing", () => {
    const entries: FavoriteEntry[] = [
      { kind: 'orphaned', favorite: favorite({ note: 'worth relearning' }) },
    ];
    expect(renderFavoritesMarkdown(entries, EXPORTED_AT)).toContain('Note: worth relearning');
  });

  it('does not count an orphan as a skill group', () => {
    const entries: FavoriteEntry[] = [
      { kind: 'card', favorite: favorite(), skill: skill(1, 'nginx'), card: card(), sources: [] },
      { kind: 'orphaned', favorite: favorite({ id: 2, itemId: 2 }) },
    ];
    expect(renderFavoritesMarkdown(entries, EXPORTED_AT)).toContain('2 items across 1 skill');
  });
});

describe('renderFavoritesMarkdown — shape', () => {
  it('ends with exactly one newline', () => {
    const entries: FavoriteEntry[] = [
      { kind: 'card', favorite: favorite(), skill: skill(1, 'nginx'), card: card(), sources: [] },
    ];
    const output = renderFavoritesMarkdown(entries, EXPORTED_AT);
    expect(output.endsWith('\n')).toBe(true);
    expect(output.endsWith('\n\n')).toBe(false);
  });
});

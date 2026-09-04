import type { FavoriteEntry } from '@shared/ipc';
import { appError, err, ok, type Result } from '@shared/result';
import type { CardsRepository } from '../db/repositories/cards';
import type { FavoritesRepository } from '../db/repositories/favorites';
import type { QuestionsRepository } from '../db/repositories/questions';
import type { SkillsRepository } from '../db/repositories/skills';
import { renderFavoritesMarkdown } from './markdown';

/**
 * Turns favourite rows into the content they name, for the favourites list and the export
 * alike — one hydration path, so what the user reads on screen and what lands in the file
 * cannot drift apart.
 */

export interface FavoritesDeps {
  readonly favorites: FavoritesRepository;
  readonly cards: CardsRepository;
  readonly questions: QuestionsRepository;
  readonly skills: SkillsRepository;
  readonly now?: () => Date;
}

export function hydrateFavorites(deps: FavoritesDeps): readonly FavoriteEntry[] {
  return deps.favorites.list().map((favorite): FavoriteEntry => {
    if (favorite.itemType === 'card') {
      const card = deps.cards.findById(favorite.itemId);
      const skill = card ? deps.skills.findById(card.skillId) : null;
      // Deleting a skill cascades its cards away; the favourite row survives on purpose,
      // so this is the expected shape of an old favourite, not a corrupted one.
      if (!card || !skill) return { kind: 'orphaned', favorite };
      return {
        kind: 'card',
        favorite,
        skill,
        // A comparison names two skills; a primer names one. The second is looked up here
        // rather than in the view so the export and the screen agree on what a card is about.
        relatedSkill:
          card.relatedSkillId === null ? null : deps.skills.findById(card.relatedSkillId),
        card,
        sources: deps.cards.sourcesFor(card.id),
      };
    }

    const question = deps.questions.findById(favorite.itemId);
    const skill = question ? deps.skills.findById(question.skillId) : null;
    if (!question || !skill) return { kind: 'orphaned', favorite };
    // A flagged question stays here. Flagging takes it out of rotation; favouriting is the
    // user saying they want to keep it. The second is not undone by the first.
    return { kind: 'question', favorite, skill, question };
  });
}

/**
 * Renders every favourite as one Markdown document.
 *
 * Refuses on an empty list rather than writing an empty file: a file with a heading and
 * nothing under it looks like the export silently lost something
 * ([feature-specs.md](../../../docs/product/feature-specs.md)).
 */
export function exportFavoritesMarkdown(deps: FavoritesDeps): Result<string> {
  const entries = hydrateFavorites(deps);
  if (entries.length === 0) {
    return err(
      appError('validation', 'nothing-to-export', 'there are no favourites to export yet'),
    );
  }
  const now = (deps.now ?? (() => new Date()))();
  return ok(renderFavoritesMarkdown(entries, now));
}

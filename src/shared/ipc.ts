/**
 * The IPC contract — the single door between the renderer and everything privileged.
 * Channels are named `domain:action` (docs/engineering/naming-conventions.md).
 * Every handler returns a Result so the renderer must handle failure to type-check.
 */

import type {
  AnswerRating,
  Card,
  ContentLanguage,
  Favorite,
  FeedbackReason,
  FeedbackTarget,
  ItemType,
  Question,
  Skill,
  Source,
  SystemStatus,
} from './domain';
import type { Result } from './result';

export const CHANNELS = {
  systemStatus: 'system:status',
  skillsList: 'skills:list',
  skillsAdd: 'skills:add',
  skillsRemove: 'skills:remove',
  cardsForSkill: 'cards:for-skill',
  skillsRelated: 'skills:related',
  questionsForSkill: 'questions:for-skill',
  questionsFlag: 'questions:flag',
  dailyGet: 'daily:get',
  dailyAnswer: 'daily:answer',
  favoritesList: 'favorites:list',
  favoritesToggle: 'favorites:toggle',
  favoritesNote: 'favorites:note',
  favoritesExport: 'favorites:export',
  settingsGet: 'settings:get',
  settingsSet: 'settings:set',
} as const;

export type Channel = (typeof CHANNELS)[keyof typeof CHANNELS];

export interface AddSkillRequest {
  readonly name: string;
  readonly contentLang: ContentLanguage;
}

export interface SettingsSetRequest {
  readonly key: string;
  readonly value: string;
}

/** A neighbour in the skill graph, with how strongly it relates. */
export interface RelatedSkill {
  readonly skill: Skill;
  readonly kind: string;
  readonly strength: number;
}

/** A card never travels without its sources — the UI is required to show them (FR-12). */
export interface CardWithSources {
  readonly card: Card;
  readonly sources: readonly Source[];
}

/**
 * A flag always carries why. A bare thumbs-down cannot be acted on: two correct options
 * and a rambling explanation are different defects with different fixes (ADR-0004).
 */
export interface FlagQuestionRequest {
  readonly questionId: number;
  readonly target: FeedbackTarget;
  readonly reason: FeedbackReason;
  readonly note?: string;
}

/**
 * One slot in today's set, already hydrated — the renderer never fetches a card or
 * question separately for an item it already has here.
 *
 * A question already flagged by the time the set is read is left out entirely rather than
 * included and disabled: membership (which ids belong to today) is frozen at assembly, but
 * content is not, and a flagged question must not be answerable a second time
 * (docs/architecture/database-design.md).
 */
export type DailySetEntry =
  | {
      readonly kind: 'card';
      readonly position: number;
      readonly completed: boolean;
      readonly card: CardWithSources;
    }
  | {
      readonly kind: 'question';
      readonly position: number;
      readonly completed: boolean;
      readonly question: Question;
    };

export interface DailySet {
  /** Local `YYYY-MM-DD` — the day this set was assembled for. */
  readonly date: string;
  readonly items: readonly DailySetEntry[];
}

export interface AnswerRequest {
  readonly itemType: ItemType;
  readonly itemId: number;
  readonly rating: AnswerRating;
}

/** A favourite with the content it names, hydrated once for both the list and the export. */
export interface FavoriteCard {
  readonly kind: 'card';
  readonly favorite: Favorite;
  readonly skill: Skill;
  readonly card: Card;
  readonly sources: readonly Source[];
}

export interface FavoriteQuestion {
  readonly kind: 'question';
  readonly favorite: Favorite;
  readonly skill: Skill;
  readonly question: Question;
}

/**
 * A favourite whose content is gone — its skill was deleted and the cascade took the card
 * or question with it. Kept rather than dropped: the user chose to keep this, and quietly
 * omitting it would be the app overriding that on their behalf
 * (docs/product/feature-specs.md).
 */
export interface OrphanedFavorite {
  readonly kind: 'orphaned';
  readonly favorite: Favorite;
}

export type FavoriteEntry = FavoriteCard | FavoriteQuestion | OrphanedFavorite;

export interface FavoriteRef {
  readonly itemType: ItemType;
  readonly itemId: number;
}

export interface FavoriteNoteRequest extends FavoriteRef {
  readonly note: string;
}

/** Where the export landed, or `null` when the user dismissed the save dialog. */
export interface ExportResult {
  readonly path: string | null;
}

/** Request and response shape per channel. Both sides derive their types from this map. */
export interface IpcContract {
  [CHANNELS.systemStatus]: { request: void; response: Result<SystemStatus> };
  [CHANNELS.skillsList]: { request: void; response: Result<readonly Skill[]> };
  [CHANNELS.skillsAdd]: { request: AddSkillRequest; response: Result<Skill> };
  [CHANNELS.skillsRemove]: { request: number; response: Result<void> };
  [CHANNELS.cardsForSkill]: { request: number; response: Result<readonly CardWithSources[]> };
  [CHANNELS.skillsRelated]: { request: number; response: Result<readonly RelatedSkill[]> };
  [CHANNELS.questionsForSkill]: { request: number; response: Result<readonly Question[]> };
  [CHANNELS.questionsFlag]: { request: FlagQuestionRequest; response: Result<void> };
  [CHANNELS.dailyGet]: { request: void; response: Result<DailySet> };
  [CHANNELS.dailyAnswer]: { request: AnswerRequest; response: Result<void> };
  [CHANNELS.favoritesList]: { request: void; response: Result<readonly FavoriteEntry[]> };
  /** Responds with the state the item is now in: `true` means favourited. */
  [CHANNELS.favoritesToggle]: { request: FavoriteRef; response: Result<boolean> };
  [CHANNELS.favoritesNote]: { request: FavoriteNoteRequest; response: Result<void> };
  [CHANNELS.favoritesExport]: { request: void; response: Result<ExportResult> };
  [CHANNELS.settingsGet]: { request: string; response: Result<string | null> };
  [CHANNELS.settingsSet]: { request: SettingsSetRequest; response: Result<void> };
}

export type IpcRequest<C extends Channel> = IpcContract[C]['request'];
export type IpcResponse<C extends Channel> = IpcContract[C]['response'];

/** The surface the preload script exposes on `window.api`. */
export interface RendererApi {
  invoke<C extends Channel>(channel: C, request: IpcRequest<C>): Promise<IpcResponse<C>>;
}

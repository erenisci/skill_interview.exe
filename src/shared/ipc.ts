/**
 * The IPC contract — the single door between the renderer and everything privileged.
 * Channels are named `domain:action` (docs/engineering/naming-conventions.md).
 * Every handler returns a Result so the renderer must handle failure to type-check.
 */

import type {
  Card,
  ContentLanguage,
  FeedbackReason,
  FeedbackTarget,
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
  [CHANNELS.settingsGet]: { request: string; response: Result<string | null> };
  [CHANNELS.settingsSet]: { request: SettingsSetRequest; response: Result<void> };
}

export type IpcRequest<C extends Channel> = IpcContract[C]['request'];
export type IpcResponse<C extends Channel> = IpcContract[C]['response'];

/** The surface the preload script exposes on `window.api`. */
export interface RendererApi {
  invoke<C extends Channel>(channel: C, request: IpcRequest<C>): Promise<IpcResponse<C>>;
}

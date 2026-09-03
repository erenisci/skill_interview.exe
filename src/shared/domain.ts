/**
 * Domain types shared across the IPC boundary.
 * Vocabulary is fixed by docs/glossary.md — a card is a card, never a note or an article.
 * String literals here must match the values stored in SQLite exactly.
 */

export type ContentLanguage = 'en' | 'tr';

export type SkillStatus = 'pending' | 'researching' | 'ready' | 'failed';

export interface Skill {
  readonly id: number;
  readonly name: string;
  readonly slug: string;
  readonly category: string | null;
  readonly tags: readonly string[];
  readonly status: SkillStatus;
  readonly contentLang: ContentLanguage;
  readonly createdAt: string;
}

export interface Source {
  readonly id: number;
  readonly skillId: number;
  readonly url: string;
  readonly title: string;
  readonly publisher: string | null;
  /** Needed for attribution: Wikipedia-derived text is CC BY-SA. */
  readonly license: string | null;
  readonly fetchedAt: string;
  /** The text the model actually saw — what makes "grounded or invented?" answerable. */
  readonly excerpt: string;
}

export type CardType = 'primer' | 'comparison';

export interface Card {
  readonly id: number;
  readonly skillId: number;
  readonly relatedSkillId: number | null;
  readonly type: CardType;
  readonly title: string;
  readonly bodyMd: string;
  readonly contentLang: ContentLanguage;
  readonly model: string;
  readonly promptVersion: string;
  readonly createdAt: string;
}

export type QuestionStatus = 'active' | 'rejected' | 'flagged';

export interface QuestionOption {
  readonly id: number;
  readonly questionId: number;
  readonly text: string;
  readonly rationale: string;
  readonly isCorrect: boolean;
  /** Which sibling skill this distractor came from; null means model-generated. */
  readonly sourceSkillId: number | null;
}

export interface Question {
  readonly id: number;
  readonly skillId: number;
  readonly cardId: number;
  readonly stem: string;
  readonly explanation: string;
  readonly difficulty: string | null;
  readonly contentLang: ContentLanguage;
  readonly model: string;
  readonly promptVersion: string;
  readonly status: QuestionStatus;
  readonly options: readonly QuestionOption[];
}

/**
 * One atomic statement about a skill, written from that skill's card.
 *
 * Claims are what questions are built out of: the correct option is a claim about the
 * skill being asked about, and the distractors are claims belonging to its neighbours.
 * A claim never names its own technology — that would give the answer away.
 */
export interface Claim {
  readonly id: number;
  readonly skillId: number;
  readonly cardId: number;
  readonly text: string;
  readonly model: string;
  readonly promptVersion: string;
  readonly createdAt: string;
}

/** A flag is about the question or about its explanation — different defects. */
export type FeedbackTarget = 'question' | 'explanation';

/**
 * Why the user rejected it. Coarse "bad" is unusable: these route to different fixes —
 * `ambiguous` and `implausible-distractors` are code problems, the rest are prompt or
 * grounding problems (ADR-0004).
 */
export type FeedbackReason =
  | 'ambiguous'
  | 'implausible-distractors'
  | 'wrong-answer'
  | 'too-easy'
  | 'off-topic'
  | 'explanation-wrong'
  | 'explanation-unclear';

export const QUESTION_REASONS: readonly FeedbackReason[] = [
  'ambiguous',
  'implausible-distractors',
  'wrong-answer',
  'too-easy',
  'off-topic',
];

export const EXPLANATION_REASONS: readonly FeedbackReason[] = [
  'explanation-wrong',
  'explanation-unclear',
];

export interface QuestionFeedback {
  readonly id: number;
  readonly questionId: number;
  readonly target: FeedbackTarget;
  readonly reason: FeedbackReason;
  readonly note: string | null;
  readonly createdAt: string;
}

export type JobKind = 'research' | 'compare' | 'generate-questions';
export type JobStatus = 'pending' | 'running' | 'done' | 'failed';

export interface Job {
  readonly id: number;
  readonly kind: JobKind;
  readonly payload: string;
  readonly status: JobStatus;
  readonly attempts: number;
  readonly error: string | null;
  /** Set while a job waits out a retry backoff; it is not claimable before this. */
  readonly retryAt: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** What the startup check found. Missing runtime and missing model are different problems. */
export type LlmReadiness =
  | { readonly state: 'ready'; readonly models: readonly string[]; readonly selected: string }
  | { readonly state: 'no-model'; readonly models: readonly string[] }
  | { readonly state: 'unreachable'; readonly url: string; readonly detail: string }
  | { readonly state: 'stub' };

export interface SystemStatus {
  readonly appVersion: string;
  readonly schemaVersion: number;
  readonly llm: LlmReadiness;
}

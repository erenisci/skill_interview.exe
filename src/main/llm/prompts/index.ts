import classifySkillV1 from './classify-skill.v1.md?raw';
import comparisonCardV1 from './comparison-card.v1.md?raw';
import contrastiveClaimsV1 from './contrastive-claims.v1.md?raw';
import primerCardV2 from './primer-card.v2.md?raw';
import questionStemV1 from './question-stem.v1.md?raw';
import resolveSourceV1 from './resolve-source.v1.md?raw';

/**
 * Prompts are product code: a prompt edit changes user-visible output without changing a
 * code path, so each is versioned in its filename and the version is stamped on every row
 * it produces (docs/llm/prompts.md).
 */
export interface Prompt {
  readonly version: string;
  readonly template: string;
}

export const RESOLVE_SOURCE: Prompt = {
  version: 'resolve-source.v1',
  template: resolveSourceV1,
};

/**
 * v2 moves the language requirement to the very end and says explicitly that the source's
 * own language does not decide the output's.
 *
 * Measured, v1 lost the argument to the source: both Turkish cases came back in English
 * ([TD-18](../../../../docs/project/tech-debt.md)). The instruction was in the middle of
 * the prompt, thousands of tokens of English source material stood between it and
 * generation, and constrained decoding gives the model no room to reconsider.
 */
export const PRIMER_CARD: Prompt = {
  version: 'primer-card.v2',
  template: primerCardV2,
};

export const CLASSIFY_SKILL: Prompt = {
  version: 'classify-skill.v1',
  template: classifySkillV1,
};

export const COMPARISON_CARD: Prompt = {
  version: 'comparison-card.v1',
  template: comparisonCardV1,
};

/**
 * One call per pair, both directions. It replaces the `question-claims` + `discriminate-claim`
 * pair, whose separate gate was measured leaving 1 of 28 distractors standing
 * ([ADR-0006](../../../../docs/architecture/adr/0006-pairwise-claims.md)).
 */
export const CONTRASTIVE_CLAIMS: Prompt = {
  version: 'contrastive-claims.v1',
  template: contrastiveClaimsV1,
};

export const QUESTION_STEM: Prompt = {
  version: 'question-stem.v1',
  template: questionStemV1,
};

/** Language names rather than codes: a model follows "Turkish" better than "tr". */
export const LANGUAGE_NAMES: Readonly<Record<string, string>> = {
  en: 'English',
  tr: 'Turkish',
};

/** Fills `{{NAME}}` placeholders. Values are data; nothing in them is re-scanned. */
export function render(prompt: Prompt, values: Readonly<Record<string, string>>): string {
  return prompt.template.replace(/\{\{(\w+)\}\}/g, (whole, key: string) => values[key] ?? whole);
}

/**
 * The system preamble every task shares. Task prompts add only what is theirs, so this is
 * never duplicated across files.
 */
export const SYSTEM_PREAMBLE =
  'You are a technical writer producing refresher material for a developer who has met the ' +
  'technology before. Work strictly from the supplied material. Report gaps rather than ' +
  'filling them from memory.';

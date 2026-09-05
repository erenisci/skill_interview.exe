import classifySkillV1 from './classify-skill.v1.md?raw';
import comparisonCardV1 from './comparison-card.v1.md?raw';
import contrastiveClaimsV2 from './contrastive-claims.v2.md?raw';
import primerCardV2 from './primer-card.v2.md?raw';
import questionStemV1 from './question-stem.v1.md?raw';
import resolveSourceV2 from './resolve-source.v2.md?raw';
import selfQuestionsV1 from './self-questions.v1.md?raw';

/**
 * Prompts are product code: a prompt edit changes user-visible output without changing a
 * code path, so each is versioned in its filename and the version is stamped on every row
 * it produces (docs/llm/prompts.md).
 */
export interface Prompt {
  readonly version: string;
  readonly template: string;
}

/**
 * v2 adds the half v1 was missing and makes the model judge every candidate before it
 * decides anything.
 *
 * v1 listed at length what to reject and never once said what a correct answer looks like.
 * Measured live against six programming languages, it refused all but one — including
 * candidate sets containing `Java (programming language)`, `TypeScript` and
 * `rust-lang/rust`. Its stated reasons were preamble rather than conclusions: the model
 * spent the `reason` field planning how it would evaluate, then emitted `null` having
 * evaluated nothing. The one case that reasoned candidate-by-candidate reached a
 * defensible answer, which is what `verdicts` now forces for all of them.
 */
export const RESOLVE_SOURCE: Prompt = {
  version: 'resolve-source.v2',
  template: resolveSourceV2,
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
 *
 * v2 applies the lesson [PRIMER_CARD] already learned, which v1 was written before and
 * never had applied to it: the language requirement sat mid-prompt with two large blocks
 * of English source material after it, and lost. On a real run every claim for four
 * Türkçe skills came back in English. It is now stated last, in the same words that took
 * the primer from 33% to 100%.
 */
export const CONTRASTIVE_CLAIMS: Prompt = {
  version: 'contrastive-claims.v2',
  template: contrastiveClaimsV2,
};

/**
 * Questions about one skill, from its own material, with no sibling to borrow from.
 *
 * The stem comes first, and that is the whole design. Asked for a true statement and three
 * false ones about a subject, the model has to judge falsity as a property of the world and
 * measured 8 of 12 with half the "false" ones true. Asked for a question and four answers, it
 * only has to know which one the material supports — the wrong answers are real mechanisms
 * that are wrong *here*, which is the judgement it makes well. Measured 14 of 17
 * (`evals/probes/stem-first-probe.ts`).
 */
export const SELF_QUESTIONS: Prompt = {
  version: 'self-questions.v1',
  template: selfQuestionsV1,
};

export const QUESTION_STEM: Prompt = {
  version: 'question-stem.v1',
  template: questionStemV1,
};

/** A name rather than a code: a model follows "English" better than "en". */
export const LANGUAGE_NAMES: Readonly<Record<string, string>> = {
  en: 'English',
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

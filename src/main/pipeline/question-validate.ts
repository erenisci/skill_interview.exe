/**
 * Structural validation for an assembled question.
 *
 * Pure on purpose, like the graph: no model, no database, no clock. This is the last thing
 * standing between a generated question and the user, and the defects it catches are the
 * ones that make a question feel worthless even when every fact in it is true — an option
 * that names the answer, four options where one is visibly longer, the same claim twice.
 *
 * It reports every violation rather than the first, because a rejected candidate is a
 * data point: the reason it was dropped is what tells us whether the pool, the prompt, or
 * the assembly is at fault ([ADR-0005](../../../docs/architecture/adr/0005-feedback-as-eval-data.md)).
 */

export interface CandidateOption {
  readonly text: string;
  readonly isCorrect: boolean;
  readonly sourceSkillId: number | null;
}

export interface CandidateQuestion {
  readonly stem: string;
  readonly explanation: string;
  readonly options: readonly CandidateOption[];
  /** The skill being asked about, plus every skill a distractor was drawn from. */
  readonly involvedNames: readonly string[];
}

export const OPTION_COUNT = 4;
export const MIN_STEM_CHARS = 15;
export const MIN_EXPLANATION_CHARS = 40;
export const MIN_OPTION_CHARS = 15;

/**
 * The oldest tell in multiple choice: the correct option is the long, careful one and the
 * distractors are short. A reader who notices scores well without knowing anything.
 *
 * Provisional, and marked as such — like the primer's length bounds, this number has not
 * been checked against a corpus of real generated questions. It belongs in the eval set,
 * not in another round of hand-tuning ([TD-03](../../../docs/project/tech-debt.md)).
 */
export const MAX_LENGTH_RATIO = 2.5;

/** Phrases that turn a four-option question into a different, worse exercise. */
const BANNED_PHRASES = [
  'all of the above',
  'none of the above',
  'both a and b',
  'yukarıdakilerin hepsi',
  'hiçbiri',
];

/** Lowercased words, with `+` and `#` kept so `c++` and `c#` survive as themselves. */
export function tokenize(text: string): readonly string[] {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}+#]+/gu, ' ')
    .trim()
    .split(' ')
    .filter((token) => token.length > 0);
}

/**
 * Whether `text` contains `name` as a run of whole words.
 *
 * Whole words rather than substrings because the short names are the dangerous ones: `Go`
 * appears inside "going" and `R` inside almost everything, and a substring test would
 * reject usable options for containing a letter.
 */
export function mentions(text: string, name: string): boolean {
  const haystack = tokenize(text);
  const needle = tokenize(name);
  if (needle.length === 0 || needle.length > haystack.length) return false;

  for (let i = 0; i <= haystack.length - needle.length; i += 1) {
    if (needle.every((token, j) => haystack[i + j] === token)) return true;
  }
  return false;
}

/** Casing and punctuation removed, so two wordings of one claim compare as the same. */
export function normalizeClaim(text: string): string {
  return tokenize(text).join(' ');
}

/**
 * Removes a technology name used as the sentence's subject.
 *
 * Measured, this is the single most common way a generated claim becomes unusable: the
 * content is right and the form gives the answer away — "nginx handles more than 10,000
 * simultaneous connections" rather than "handles more than 10,000…". Dropping those threw
 * away most of a run's usable claims for a reason that is a prefix.
 *
 * Deliberately narrow. It strips a **leading** subject and nothing else: a name buried
 * mid-sentence cannot be removed without rewriting the sentence, and rewriting a claim by
 * regex is how a grammatical option becomes a broken one. Those are still dropped.
 */
export function stripLeadingSubject(text: string, names: readonly string[]): string {
  const trimmed = text.trim();
  for (const name of names) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const leading = new RegExp(`^(the\\s+)?${escaped}(['’]s)?\\s+`, 'i');
    if (leading.test(trimmed)) return trimmed.replace(leading, '');
  }
  return trimmed;
}

export function validateQuestion(candidate: CandidateQuestion): readonly string[] {
  const violations: string[] = [];
  const { options } = candidate;

  if (options.length !== OPTION_COUNT) {
    violations.push(`option-count:${options.length}`);
  }
  const correct = options.filter((option) => option.isCorrect);
  if (correct.length !== 1) {
    violations.push(`correct-count:${correct.length}`);
  }

  if (candidate.stem.trim().length < MIN_STEM_CHARS) violations.push('stem-too-short');
  if (candidate.explanation.trim().length < MIN_EXPLANATION_CHARS) {
    violations.push('explanation-too-short');
  }

  const seen = new Set<string>();
  for (const option of options) {
    const text = option.text.trim();

    if (text.length < MIN_OPTION_CHARS) violations.push('option-too-short');

    const normalized = normalizeClaim(text);
    if (seen.has(normalized)) violations.push('duplicate-option');
    seen.add(normalized);

    const lower = text.toLowerCase();
    if (BANNED_PHRASES.some((phrase) => lower.includes(phrase))) {
      violations.push('banned-phrase');
    }

    // No option may name any technology in play. On the correct option that hands over
    // the answer; on a distractor it does the same in reverse — an option that names a
    // neighbour is visibly not about the skill in the stem.
    for (const name of candidate.involvedNames) {
      if (mentions(text, name)) {
        violations.push(`option-names-skill:${name}`);
        break;
      }
    }
  }

  const lengths = options.map((option) => option.text.trim().length).filter((n) => n > 0);
  if (lengths.length === options.length && lengths.length > 0) {
    const longest = Math.max(...lengths);
    const shortest = Math.min(...lengths);
    if (longest / shortest > MAX_LENGTH_RATIO) {
      violations.push('length-imbalance');
    }
  }

  return violations;
}

/**
 * Fisher–Yates, with the source of randomness injected.
 *
 * Shuffling is not cosmetic: options are assembled correct-first, so without this every
 * answer would be the first one. Injecting `random` is what lets a test assert the
 * shuffle happened rather than hope it did.
 */
export function shuffle<T>(items: readonly T[], random: () => number): T[] {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    const a = result[i] as T;
    const b = result[j] as T;
    result[i] = b;
    result[j] = a;
  }
  return result;
}

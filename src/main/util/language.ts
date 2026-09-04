import { normalizeSkillName } from './slug';

/**
 * Two cheap text checks the pipeline needs before and after a model call, kept together
 * because both answer "is this text what we asked for?" without asking a model.
 *
 * The eval harness scores with these exact functions rather than its own copies. A guard
 * and the metric that measures it must agree by construction — otherwise a run can pass
 * while the shipped behaviour differs, which is how an eval stops meaning anything.
 */

const MIN_STEM = 4;

function normalize(text: string): string {
  return text
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * Whether retrieved text is plausibly *about* the skill at all.
 *
 * The last line of defence for the grounding rule. Resolution already decided the source is
 * about the subject, but extraction can still hand synthesis a sign-in page or a consent
 * dialog from the same URL — and measured, the model will happily write a fluent card from
 * one, filling the space from its own memory
 * ([TD-17](../../../docs/project/tech-debt.md)).
 *
 * A prefix match rather than an exact one, on the same reasoning as the name gate: a page
 * about PostgreSQL that only ever writes "Postgres" is still about PostgreSQL, and
 * rejecting it would trade a real source for a hypothetical one.
 */
export function sourceMentionsSkill(sourceText: string, skill: string): boolean {
  const words = new Set(normalize(sourceText).split(' '));
  const needles = normalize(normalizeSkillName(skill)).split(' ').filter(Boolean);
  if (needles.length === 0) return false;

  return needles.some((needle) => {
    if (words.has(needle)) return true;
    if (needle.length < MIN_STEM) return false;
    // "postgresql" is satisfied by a page saying "postgres", and the other way round.
    for (const word of words) {
      if (word.length < MIN_STEM) continue;
      if (needle.startsWith(word) || word.startsWith(needle)) return true;
    }
    return false;
  });
}

/** The words English prose repeats regardless of topic. */
const ENGLISH_STOPWORDS = [
  ' the ',
  ' and ',
  ' with ',
  ' that ',
  ' from ',
  ' this ',
  ' for ',
  ' of ',
  ' to ',
  ' in ',
  ' is ',
  ' are ',
  ' as ',
  ' by ',
];

/**
 * Whether prose reads as English, by stopword frequency rather than by asking a model.
 *
 * Crude on purpose, and only meaningful on text of at least a paragraph. It once had to
 * separate English from Turkish; the product is English-only now
 * ([domain.ts](../../shared/domain.ts)), so what is left is a sanity check that a card is
 * prose in the language the prompt asked for rather than a fragment in another one.
 *
 * Not applied to claims. A claim is a handful of words — "handles TLS termination" contains
 * no stopword at all — and a check that cannot tell silence from failure is worse than no
 * check on text that short.
 */
export function looksLikeEnglish(text: string): boolean {
  const padded = ` ${text.toLowerCase()} `;
  return ENGLISH_STOPWORDS.some((word) => padded.includes(word));
}

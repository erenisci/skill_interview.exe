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

/** Latin letters unique to Turkish, and the words each language repeats regardless of topic. */
const TURKISH_LETTERS = /[ğışçöüĞİŞÇÖÜ]/;
const TURKISH_STOPWORDS = [' ve ', ' bir ', ' için ', ' olarak ', ' ile ', ' bu '];
const ENGLISH_STOPWORDS = [' the ', ' and ', ' with ', ' that ', ' from ', ' this '];

/**
 * Which language prose is in, by stopword frequency rather than by asking a model.
 *
 * Crude on purpose. It only has to separate two languages that are far apart, on text of at
 * least a paragraph, and being wrong is visible rather than silent: a card a human reads as
 * Turkish while this calls it English is a bug in this function, not a quiet mis-score.
 */
export function looksLike(text: string, language: 'en' | 'tr'): boolean {
  const padded = ` ${text.toLowerCase()} `;
  const turkish =
    TURKISH_STOPWORDS.filter((word) => padded.includes(word)).length +
    (TURKISH_LETTERS.test(text) ? 2 : 0);
  const english = ENGLISH_STOPWORDS.filter((word) => padded.includes(word)).length;
  return language === 'tr' ? turkish > english : english > turkish;
}

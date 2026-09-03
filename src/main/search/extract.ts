/**
 * HTML → plain text.
 *
 * Deliberately crude: this is not a readability implementation, and it does not try to
 * find "the article". It strips what is definitely not prose and leaves the rest, because
 * over-clever extraction fails silently on the pages it guesses wrong about, and a card
 * built from a navigation menu is worse than a failed job.
 *
 * Everything here treats its input as hostile — it is arbitrary web HTML on its way to a
 * prompt (docs/llm/guardrails.md).
 */

const STRIP_BLOCKS = /<(script|style|nav|header|footer|svg|noscript|template)\b[\s\S]*?<\/\1>/gi;
const COMMENTS = /<!--[\s\S]*?-->/g;
const TAGS = /<[^>]+>/g;

const ENTITIES: Readonly<Record<string, string>> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  '#39': "'",
  mdash: '—',
  ndash: '–',
};

function decodeEntities(text: string): string {
  return text.replace(/&(#?\w+);/g, (whole, name: string) => ENTITIES[name.toLowerCase()] ?? whole);
}

/**
 * In HTML the structure lives in the tags, and the newlines are source formatting. Once
 * the tags are gone there is nothing left for a line break to mean, so all whitespace
 * collapses to single spaces.
 */
export function htmlToText(html: string): string {
  return decodeEntities(html.replace(COMMENTS, ' ').replace(STRIP_BLOCKS, ' ').replace(TAGS, ' '))
    .replace(/\s+/g, ' ')
    .trim();
}

/** Markdown needs far less: it is already prose, minus the syntax that adds no meaning. */
export function markdownToText(markdown: string): string {
  return (
    markdown
      .replace(/```[\s\S]*?```/g, ' ') // fenced code says little about what a tool *is*
      .replace(/^\s{0,3}(#{1,6})\s+/gm, '')
      .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ') // images
      .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1') // links keep their text
      .replace(/<[^>]+>/g, ' ') // READMEs embed badges and HTML
      .replace(/[*_`>]/g, '')
      // Unlike HTML, a blank line here is content: it separates paragraphs. Only the
      // horizontal whitespace is collapsed, and runs of blank lines are capped at one.
      .replace(/[^\S\n]+/g, ' ')
      .replace(/[^\S\n]*\n[^\S\n]*/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim()
  );
}

const MIN_USABLE_CHARS = 200;

/**
 * A page that extracted to almost nothing is a login wall, a JavaScript shell, or a
 * redirect stub. Discarding it here means the pipeline fails visibly rather than asking
 * the model to write a card from three words.
 */
export function isUsable(text: string): boolean {
  return text.length >= MIN_USABLE_CHARS;
}

/**
 * Truncates on a word boundary. The budget is bounded by VRAM as much as by the prompt
 * (docs/operations/performance.md), so this is a real constraint rather than tidiness.
 */
export function truncate(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  const cut = text.slice(0, maxChars);
  const lastBreak = cut.lastIndexOf(' ');
  // Prefer the word boundary unless taking it would throw away more than half the
  // budget — at that point a clean break costs more context than the ragged word does.
  return (lastBreak > maxChars * 0.5 ? cut.slice(0, lastBreak) : cut).trimEnd();
}

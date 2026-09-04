/**
 * The metrics a machine can settle, and only those.
 *
 * Groundedness, distractor plausibility and ambiguity are deliberately **not** here. They
 * are judged by a person, because an LLM-as-judge inherits the failure modes of the model
 * under test — it is most confident exactly where that model is most wrong, so scoring a
 * 4B model's cards with the same 4B model would measure agreement, not truth
 * ([eval-harness.md](../../docs/llm/eval-harness.md)).
 *
 * Every function here is pure and takes its input explicitly, so the scoring can be tested
 * without a model, a network, or a database.
 */

/**
 * Re-exported from the app rather than reimplemented here.
 *
 * `synthesizePrimer` now refuses a card in the wrong language using this exact function
 * ([TD-18](../../docs/project/tech-debt.md)). A guard and the metric that scores it must
 * agree by construction — two copies drifting apart is how a run passes while the shipped
 * behaviour differs.
 */
export { looksLike } from '../../src/main/util/language';

export interface Tally {
  readonly passed: number;
  readonly total: number;
}

export function tally(results: readonly boolean[]): Tally {
  return { passed: results.filter(Boolean).length, total: results.length };
}

/** `0` when nothing was measured — an empty set scores zero, never a vacuous 100%. */
export function rate(counts: Tally): number {
  return counts.total === 0 ? 0 : counts.passed / counts.total;
}

export function percent(counts: Tally): string {
  return counts.total === 0 ? '—' : `${((counts.passed / counts.total) * 100).toFixed(0)}%`;
}

/**
 * Resolution picked the candidate the set says is the technology — or correctly answered
 * "none" when no candidate is.
 *
 * Both halves matter and they fail differently. Picking the wrong candidate produces a
 * fluent, cited card about the wrong subject; failing to refuse produces the same thing
 * from a set where nothing was right at all
 * ([ADR-0003](../../docs/architecture/adr/0003-source-resolution.md)).
 */
export function resolutionCorrect(expected: number | null, actual: number | null): boolean {
  return expected === actual;
}

/**
 * Whether an embedded instruction was ignored.
 *
 * Checked by looking for what obeying it would have produced, not for the instruction
 * text: a card that quotes the injected sentence while explaining that it ignored it is
 * still correct behaviour, and a naive substring check on the instruction would fail it.
 */
export function resistedInjection(output: string, forbidden: readonly string[]): boolean {
  const haystack = output.toLowerCase();
  return !forbidden.some((marker) => haystack.includes(marker.toLowerCase()));
}

/**
 * Whether every technical term survived untranslated.
 *
 * This is the specific Turkish risk the prompts guard against: a model asked to write in
 * Turkish will happily render "reverse proxy" as "ters vekil sunucu", which is correct
 * Turkish and useless to someone preparing for an interview conducted in the original
 * terms.
 */
export function keptTerms(text: string, terms: readonly string[]): boolean {
  const haystack = text.toLowerCase();
  return terms.every((term) => haystack.includes(term.toLowerCase()));
}

export interface MetricRow {
  readonly metric: string;
  readonly counts: Tally;
  /** What a reader needs to know to act on the number, in one line. */
  readonly note: string;
}

/** Formats the deterministic metrics as the table `eval-harness.md` records per run. */
export function renderMetricsTable(rows: readonly MetricRow[]): string {
  const header = ['| Metric | Score | Passed | Note |', '| --- | --- | --- | --- |'];
  const body = rows.map(
    (row) =>
      `| ${row.metric} | ${percent(row.counts)} | ` +
      `${String(row.counts.passed)}/${String(row.counts.total)} | ${row.note} |`,
  );
  return [...header, ...body].join('\n');
}

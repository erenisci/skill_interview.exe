/**
 * Is the material the pipeline retrieves deep enough to ask an interview question from?
 *
 * Item 6 of the working plan says the sources are too thin — that an encyclopedia article
 * explains what a language *is* rather than how it is used, so "what does `private` mean"
 * has nothing to stand on. That is a plausible claim and this measures it before anything
 * about retrieval changes, because retrieval touches the product's second rule (grounding
 * is absolute) and a wrong answer there makes cards fluent and invented.
 *
 * Two things are counted, per frozen source and per generated primer:
 *
 * 1. **How much of it is provenance rather than mechanism** — dates, licences, authorship,
 *    version history. Counted with `looksLikeTrivia`, the same function that now filters
 *    claims, so the guard and this measurement cannot disagree.
 * 2. **Whether the concepts an interview asks about appear at all.** A short hand-written
 *    list per subject; crude, and enough to tell "not covered" from "covered thinly".
 *
 *   npx vite-node --config vitest.config.ts evals/probes/material-depth-probe.ts
 */
import { looksLikeTrivia } from '../../src/main/pipeline/question-validate';
import { loadSource } from '../harness/sets';

/** What a senior engineer would actually ask about each, written before looking. */
const CONCEPTS: Readonly<Record<string, readonly string[]>> = {
  'nginx.txt': ['worker', 'reverse proxy', 'buffer', 'upstream', 'reload', 'event loop'],
  'redis.txt': ['persistence', 'expiry', 'eviction', 'transaction', 'replication', 'pub/sub'],
  'postgresql.txt': ['index', 'transaction', 'isolation', 'vacuum', 'query plan', 'constraint'],
  'haproxy.txt': ['health check', 'sticky', 'backend', 'timeout', 'retry', 'load balancing'],
};

function sentences(text: string): readonly string[] {
  return text
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 30);
}

console.log('Source material — how much is provenance, and what concepts it reaches\n');

for (const [file, concepts] of Object.entries(CONCEPTS)) {
  const text = loadSource(file);
  const all = sentences(text);
  const provenance = all.filter(looksLikeTrivia);
  const covered = concepts.filter((concept) => text.toLowerCase().includes(concept.toLowerCase()));

  const share = all.length === 0 ? 0 : Math.round((provenance.length / all.length) * 100);
  console.log(`=== ${file} — ${String(all.length)} sentences`);
  console.log(`  provenance: ${String(provenance.length)} (${String(share)}%)`);
  console.log(
    `  concepts:   ${String(covered.length)}/${String(concepts.length)} — ${covered.join(', ') || 'none'}`,
  );
  const missing = concepts.filter((c) => !covered.includes(c));
  if (missing.length > 0) console.log(`  missing:    ${missing.join(', ')}`);
}

console.log(
  '\nA concept that never appears in the material cannot be asked about without inventing it,' +
    '\nwhich the grounding rule forbids outright.',
);

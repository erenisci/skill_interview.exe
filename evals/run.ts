import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { OllamaLlmAdapter } from '../src/main/llm/ollama';
import { generatePairClaims } from '../src/main/pipeline/questions';
import { resolveSource } from '../src/main/pipeline/resolve';
import { synthesizePrimer } from '../src/main/pipeline/synthesize';
import type { Candidate } from '../src/main/search/adapter';
import {
  keptTerms,
  looksLikeEnglish,
  renderMetricsTable,
  resistedInjection,
  resolutionCorrect,
  tally,
  type MetricRow,
} from './harness/scoring';
import {
  loadSet,
  loadSource,
  type DisambiguationCase,
  type GroundingCase,
  type InjectionCase,
  type LanguageCase,
  type PlausibilityCase,
  type RefusalCase,
} from './harness/sets';

/**
 * `npm run eval` — the second test suite.
 *
 * The unit tests prove the code works. This measures whether what it produces is any good,
 * which is the thing that decides if the product is worth using at all
 * ([eval-harness.md](../docs/llm/eval-harness.md)).
 *
 * It runs the **real** pipeline stages against the **real** adapter, over frozen inputs.
 * That matters more than it sounds: the one-off probes in `evals/probes/` re-implement the
 * Ollama call in plain JavaScript, so they can drift from what ships without anyone
 * noticing. This imports `resolveSource`, `synthesizePrimer` and `generatePairClaims`
 * directly, so a prompt or pipeline change is measured the moment it lands.
 *
 * Two kinds of metric come out, and mixing them up would be the easiest way to make this
 * worthless:
 *
 * - **Deterministic** — resolution precision and refusal, injection resistance, language
 *   accuracy, schema pass rate. Scored here, in code.
 * - **Judged** — groundedness, distractor plausibility, ambiguity. Written to a review
 *   file for a person to score. Never scored by a second model call: an LLM-as-judge
 *   inherits the failure modes of the model under test, and is most confident exactly
 *   where that model is most wrong.
 */

const OLLAMA_URL = process.env['OLLAMA_URL'] ?? 'http://localhost:11434';
const MODEL = process.env['OLLAMA_MODEL'] ?? 'qwen3:4b';
const RESULTS_DIR = join(import.meta.dirname, 'results');

const llm = new OllamaLlmAdapter({ url: OLLAMA_URL, model: MODEL });

/**
 * Schema conformance is counted across every generation this run performs, rather than
 * from a set of its own. Sampling real usage is strictly better than a synthetic set: it
 * measures the prompts that actually run, in the proportions they actually run in.
 */
const schema = { passed: 0, total: 0 };

/** The only two codes that mean the model's output did not parse. */
const PARSE_FAILURES = new Set(['not-json', 'schema-mismatch']);

/**
 * Records whether the *output parsed*, which is not the same as whether the card was kept.
 *
 * A card rejected for being in the wrong language or too short parsed perfectly — it was
 * refused on content, by a guard downstream. Counting that as a schema failure would blame
 * ADR-0002 for a guard doing its job, and would move a number that is supposed to describe
 * decoding whenever unrelated validation changes.
 */
function recordSchema(result: {
  readonly ok: boolean;
  readonly error?: { readonly code: string };
}): void {
  schema.total += 1;
  if (result.ok || !PARSE_FAILURES.has(result.error?.code ?? '')) schema.passed += 1;
}

/**
 * The harness only supplies what the resolution stage reads; the rest is scaffolding.
 *
 * `identity` defaults to the title for Wikipedia-shaped cases, where they are the same
 * string, and is given explicitly for GitHub-shaped ones, where they are not.
 */
function asCandidate(entry: { title: string; lead: string; identity?: string }): Candidate {
  return {
    provider: 'github',
    identity: entry.identity ?? entry.title,
    title: entry.title,
    url: `https://example.invalid/${encodeURIComponent(entry.title)}`,
    lead: entry.lead,
    publisher: 'eval',
    license: null,
  };
}

async function runDisambiguation(): Promise<MetricRow[]> {
  const cases = loadSet<DisambiguationCase>('disambiguation');
  const picks: boolean[] = [];
  const refusals: boolean[] = [];

  for (const testCase of cases) {
    const candidates = testCase.candidates.map(asCandidate);
    const result = await resolveSource(testCase.skill, candidates, { llm });

    // Either gate refusing is the stage answering "none" — the distinction between the
    // name gate and the subject check matters when debugging, not when scoring.
    const actual = result.ok ? candidates.indexOf(result.value.candidate) : null;
    const correct = resolutionCorrect(testCase.expected, actual);

    // Only the subject check reaches the model; a name-gate refusal never asks it, so it
    // cannot count for or against schema conformance.
    if (result.ok || result.error.code === 'no-subject-match') recordSchema({ ok: true });

    if (testCase.expected === null) refusals.push(correct);
    else picks.push(correct);

    console.log(
      `  ${correct ? 'ok  ' : 'FAIL'} ${testCase.id}: expected ${String(testCase.expected)}, got ${String(actual)}`,
    );
  }

  return [
    {
      metric: 'Resolution precision',
      counts: tally(picks),
      note: 'the right candidate was chosen',
    },
    {
      metric: 'Resolution refusal',
      counts: tally(refusals),
      note: '"none" chosen when nothing was right',
    },
  ];
}

async function runRefusal(): Promise<MetricRow> {
  const cases = loadSet<RefusalCase>('refusal');
  const results: boolean[] = [];

  for (const testCase of cases) {
    const card = await synthesizePrimer(testCase.skill, loadSource(testCase.sourceFile), 'en', {
      llm,
    });
    // Failing is the pass condition: retrieval produced nothing usable, so a card would
    // have had to come from the model's own memory.
    const refused = !card.ok;
    results.push(refused);
    console.log(
      `  ${refused ? 'ok  ' : 'FAIL'} ${testCase.id}: ${refused ? `refused (${card.ok ? '' : card.error.code})` : 'wrote a card anyway'}`,
    );
  }

  return {
    metric: 'Refusal rate',
    counts: tally(results),
    note: 'useless retrieval failed the job',
  };
}

async function runInjection(): Promise<MetricRow> {
  const cases = loadSet<InjectionCase>('injection');
  const results: boolean[] = [];

  for (const testCase of cases) {
    const card = await synthesizePrimer(testCase.skill, loadSource(testCase.sourceFile), 'en', {
      llm,
    });
    recordSchema(card);

    // A refusal also resists — the payload never reached the user either way.
    const output = card.ok ? `${card.value.title}\n${card.value.body}` : '';
    const resisted = resistedInjection(output, testCase.forbidden);
    results.push(resisted);
    console.log(`  ${resisted ? 'ok  ' : 'FAIL'} ${testCase.id}`);
  }

  return {
    metric: 'Injection resistance',
    counts: tally(results),
    note: 'embedded instructions ignored',
  };
}

async function runLanguage(): Promise<MetricRow[]> {
  const cases = loadSet<LanguageCase>('language');
  const languages: boolean[] = [];
  const terms: boolean[] = [];

  for (const testCase of cases) {
    const card = await synthesizePrimer(testCase.skill, loadSource(testCase.sourceFile), 'en', {
      llm,
    });
    recordSchema(card);
    if (!card.ok) {
      // Language counts as failed — the user asked for a card and got none.
      // Term retention does not: there is no prose to check, and scoring it would punish
      // the same failure twice and drag an unrelated metric down with it.
      languages.push(false);
      console.log(`  FAIL ${testCase.id}: ${card.error.code}`);
      continue;
    }

    const rightLanguage = looksLikeEnglish(card.value.body);
    const rightTerms = keptTerms(card.value.body, testCase.keepTerms);
    languages.push(rightLanguage);
    terms.push(rightTerms);
    console.log(
      `  ${rightLanguage && rightTerms ? 'ok  ' : 'FAIL'} ${testCase.id}: ` +
        `language ${rightLanguage ? 'ok' : 'wrong'}, terms ${rightTerms ? 'kept' : 'translated'}`,
    );
  }

  return [
    {
      metric: 'Language accuracy',
      counts: tally(languages),
      note: 'prose in the requested language',
    },
    {
      metric: 'Terms untranslated',
      counts: tally(terms),
      note: 'technical terms left in the original',
    },
  ];
}

/** Generates the material a person scores, and writes it out. Nothing here is scored. */
async function collectForReview(): Promise<string[]> {
  const lines: string[] = [
    '# Eval review',
    '',
    `Model: \`${MODEL}\`. Generated ${new Date().toISOString()}.`,
    '',
    'Groundedness, distractor plausibility and ambiguity are scored here, by a person.',
    'They are not machine-scored on purpose: an LLM-as-judge inherits the failure modes of',
    'the model under test, so it agrees with exactly the mistakes that matter most.',
    '',
    'For each item below, mark it pass or fail and record the totals in',
    '`docs/llm/eval-harness.md`.',
    '',
    '## Groundedness',
    '',
    'Does every sentence follow from the frozen source? A fluent sentence the source does',
    'not support is the failure this product exists to prevent.',
  ];

  for (const testCase of loadSet<GroundingCase>('grounding')) {
    const card = await synthesizePrimer(testCase.skill, loadSource(testCase.sourceFile), 'en', {
      llm,
    });
    recordSchema(card);
    lines.push(
      '',
      `### ${testCase.skill} (\`${testCase.id}\`) — source: \`${testCase.sourceFile}\``,
      '',
    );
    lines.push(
      card.ok ? `**${card.value.title}**\n\n${card.value.body}` : `_failed: ${card.error.code}_`,
    );
    lines.push('', '- [ ] grounded — every claim supported by the source');
    console.log(`  wrote grounding/${testCase.id}`);
  }

  lines.push(
    '',
    '## Distractor plausibility and ambiguity',
    '',
    'For each claim: is it true of its own technology, **and** false of the other? A claim',
    'true of both is the ambiguity failure — the reader answers correctly and is told they',
    'are wrong.',
  );

  for (const testCase of loadSet<PlausibilityCase>('distractor-plausibility')) {
    const claims = await generatePairClaims(
      llm,
      { name: testCase.skillA, material: loadSource(testCase.sourceFileA) },
      { name: testCase.skillB, material: loadSource(testCase.sourceFileB) },
      'en',
    );
    recordSchema(claims);
    lines.push('', `### ${testCase.skillA} vs ${testCase.skillB} (\`${testCase.id}\`)`, '');
    if (!claims.ok) {
      lines.push(`_failed: ${claims.error.code}_`);
      console.log(`  FAIL plausibility/${testCase.id}: ${claims.error.code}`);
      continue;
    }
    for (const claim of claims.value.aClaims) {
      lines.push(`- [ ] **${testCase.skillA}:** ${claim}`);
    }
    for (const claim of claims.value.bClaims) {
      lines.push(`- [ ] **${testCase.skillB}:** ${claim}`);
    }
    console.log(
      `  wrote plausibility/${testCase.id}: ${String(claims.value.aClaims.length)}/${String(claims.value.bClaims.length)} claims`,
    );
  }

  return lines;
}

async function main(): Promise<void> {
  console.log(`eval: ${MODEL} at ${OLLAMA_URL}\n`);

  console.log('disambiguation');
  const resolution = await runDisambiguation();
  console.log('\nrefusal');
  const refusal = await runRefusal();
  console.log('\ninjection');
  const injection = await runInjection();
  console.log('\nlanguage');
  const language = await runLanguage();
  console.log('\nreview material');
  const review = await collectForReview();

  const rows: MetricRow[] = [
    ...resolution,
    refusal,
    injection,
    ...language,
    {
      metric: 'Schema pass rate',
      counts: schema,
      note: 'parsed on the first attempt, across every call this run made',
    },
  ];

  mkdirSync(RESULTS_DIR, { recursive: true });
  const stamp = new Date().toISOString().slice(0, 10);
  const table = renderMetricsTable(rows);

  writeFileSync(
    join(RESULTS_DIR, `${stamp}-${MODEL.replace(/[:/]/g, '-')}.md`),
    review.join('\n'),
    'utf8',
  );

  console.log(`\n${table}\n`);
  console.log(`Review material: evals/results/${stamp}-${MODEL.replace(/[:/]/g, '-')}.md`);
  console.log('Record the deterministic scores in docs/llm/eval-harness.md once reviewed.');

  await llm.release();
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});

/**
 * Why the three most common CV skills in existence failed research.
 *
 * Run live 2026-09-04 after Java, Python and Typescript all failed on a real machine. Two
 * suspects, and they need separating rather than guessing between:
 *
 * 1. Gate 1 discarded the right article. Measured and confirmed against live Wikipedia —
 *    a disambiguating qualifier sank the ratio, so `Java (programming language)` was
 *    rejected while `Java`, the Indonesian island, sailed through. Fixed in `resolve.ts`.
 * 2. Gate 2 refused a candidate set that contained the right article anyway. Typescript's
 *    own Wikipedia article passed gate 1 and the model still answered "none", giving a
 *    reason that reads as preamble rather than a conclusion.
 *
 * This probe runs the **shipped** search and resolve against the live providers and the
 * real model, so the two are told apart by measurement. Not part of `npm run eval`: it
 * fetches from the network and needs Ollama, which the frozen eval sets exist to avoid.
 *
 *   npx vite-node --config vitest.config.ts evals/probes/language-resolve-probe.ts
 */
import { OllamaLlmAdapter } from '../../src/main/llm/ollama';
import { applyNameGate, resolveSource } from '../../src/main/pipeline/resolve';
import type { Candidate } from '../../src/main/search/adapter';
import { GithubSearchAdapter } from '../../src/main/search/github';
import { WikipediaSearchAdapter } from '../../src/main/search/wikipedia';

const SKILLS = ['Java', 'Python', 'Typescript', 'Go', 'Rust', 'C'];

const llm = new OllamaLlmAdapter({
  url: process.env['OLLAMA_URL'] ?? 'http://localhost:11434',
  model: process.env['OLLAMA_MODEL'] ?? 'qwen3:4b',
});

const github = new GithubSearchAdapter({});
const wikipedia = new WikipediaSearchAdapter();

async function candidatesFor(skill: string): Promise<readonly Candidate[]> {
  const found: Candidate[] = [];
  for (const adapter of [github, wikipedia]) {
    const result = await adapter.findCandidates(skill);
    if (result.ok) found.push(...result.value);
    else console.log(`  (${adapter.id} failed: ${result.error.message})`);
  }
  return found;
}

let resolved = 0;

for (const skill of SKILLS) {
  console.log(`\n=== ${skill} ===`);
  const candidates = await candidatesFor(skill);
  const named = applyNameGate(skill, candidates);

  console.log(`  ${String(candidates.length)} candidates, ${String(named.length)} past gate 1:`);
  for (const candidate of named) console.log(`    - [${candidate.provider}] ${candidate.title}`);

  if (named.length === 0) {
    console.log('  GATE 1 REJECTED EVERYTHING');
    continue;
  }

  const result = await resolveSource(skill, candidates, { llm });
  if (result.ok) {
    resolved += 1;
    console.log(`  RESOLVED -> ${result.value.candidate.title}`);
    console.log(`  reason: ${result.value.reason}`);
  } else {
    console.log(`  GATE 2 REFUSED: ${result.error.message}`);
  }
}

await llm.release();
console.log(`\n${String(resolved)}/${String(SKILLS.length)} resolved.`);

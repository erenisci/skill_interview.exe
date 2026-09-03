/**
 * Resolution probe — can a small local model refuse?
 *
 * ADR-0003's second gate asks the model which candidate is about a technology, and lets
 * it answer "none". The whole honesty of the product rests on that refusal working: a
 * model that always picks *something* would confidently ground a card in the wrong
 * subject, which is worse than writing nothing.
 *
 * Unlike the other probes this one needs Ollama running with the recommended model. It
 * uses the real prompt file, so a prompt edit changes what is measured.
 *
 *   ollama serve
 *   node evals/probes/resolve-probe.mjs
 */

import { readFileSync } from 'node:fs';

const OLLAMA = process.env.OLLAMA_URL ?? 'http://localhost:11434';
const MODEL = process.env.OLLAMA_MODEL ?? 'qwen3:4b';
const PROMPT_PATH = 'src/main/llm/prompts/resolve-source.v1.md';

const SYSTEM =
  'You are a technical writer producing refresher material for a developer who has met the ' +
  'technology before. Work strictly from the supplied material. Report gaps rather than ' +
  'filling them from memory.';

const SCHEMA = {
  type: 'object',
  properties: { index: { type: ['integer', 'null'] }, reason: { type: 'string' } },
  required: ['index', 'reason'],
};

/** The real collisions found by precision-probe.mjs, plus the ones that must be accepted. */
const CASES = [
  {
    label: 'Tauri — only the ancient people',
    skill: 'Tauri',
    expected: null,
    candidates: [
      {
        title: 'Tauri',
        lead: 'The Tauri were an ancient people settled on the southern coast of the Crimean peninsula.',
      },
    ],
  },
  {
    label: 'Tauri — ancient people and the framework',
    skill: 'Tauri',
    expected: 1,
    candidates: [
      {
        title: 'Tauri',
        lead: 'The Tauri were an ancient people settled on the southern coast of the Crimean peninsula.',
      },
      {
        title: 'tauri-apps/tauri',
        lead: 'Build smaller, faster, and more secure desktop and mobile applications with a web frontend.',
      },
    ],
  },
  {
    label: 'Zustand — the React library',
    skill: 'Zustand',
    expected: 0,
    candidates: [
      { title: 'pmndrs/zustand', lead: 'Bear necessities for state management in React' },
    ],
  },
  {
    label: 'Redis — an interview guide that mentions it',
    skill: 'Redis',
    expected: null,
    candidates: [
      {
        title: 'Snailclimb/JavaGuide',
        lead: 'A Java interview guide covering computer fundamentals, databases, distributed systems and high concurrency.',
      },
    ],
  },
  {
    label: 'tRPC — the ion channels',
    skill: 'tRPC',
    expected: null,
    candidates: [
      {
        title: 'TRPC',
        lead: 'TRPC is a family of transient receptor potential cation channels in animals.',
      },
    ],
  },
];

const template = readFileSync(PROMPT_PATH, 'utf8');

async function resolve(skill, candidates) {
  const listing = candidates.map((c, i) => `[${i}] ${c.title}\n${c.lead}`).join('\n\n');
  const prompt = template.replaceAll('{{SKILL}}', skill).replace('{{CANDIDATES}}', listing);

  const res = await fetch(`${OLLAMA}/api/chat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      model: MODEL,
      stream: false,
      think: false,
      keep_alive: '3m',
      format: SCHEMA,
      options: { num_ctx: 4096, num_gpu: 99 },
      messages: [
        { role: 'system', content: SYSTEM },
        { role: 'user', content: prompt },
      ],
    }),
  });
  if (!res.ok) throw new Error(`ollama responded ${res.status}`);
  const body = await res.json();
  return JSON.parse(body.message.content);
}

let passed = 0;
for (const testCase of CASES) {
  try {
    const answer = await resolve(testCase.skill, testCase.candidates);
    const correct = answer.index === testCase.expected;
    if (correct) passed += 1;
    console.log(
      `${correct ? 'OK  ' : 'FAIL'} ${testCase.label.padEnd(42)} expected=${String(testCase.expected).padEnd(4)} got=${String(answer.index).padEnd(4)}`,
    );
    console.log(`     ${String(answer.reason).slice(0, 150)}`);
  } catch (e) {
    console.log(`ERR  ${testCase.label}: ${e.message}`);
  }
}

console.log(`\n${passed}/${CASES.length} correct.`);
console.log(`
Refusal is the number to watch: three of these five have no right answer, and a model
that never says "none" would score 2/5 while looking confident every time.
`);

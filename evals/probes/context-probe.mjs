/**
 * Context probe — do the real prompts fit the context window?
 *
 * Every truncation budget in the pipeline was picked before there was any retrieved text
 * to check it against, and `num_ctx` was set to 4096 for the same reason. The two are one
 * question: a prompt longer than the window is **silently truncated** by the runtime, so
 * the failure mode is not an error but a card written from material the model never saw.
 * Nothing downstream can detect that.
 *
 * The tightest case is no longer the primer. Pairwise claims send two materials in one
 * prompt (ADR-0006), and the comparison card does the same, so those set the floor.
 *
 * Raising `num_ctx` is not free: a larger window reserves more VRAM, and on a 4 GB card
 * that is exactly how the model gets pushed off the GPU — the failure that cost 82.8 s per
 * card before it was measured (docs/operations/performance.md). So this reports both.
 *
 *   ollama serve
 *   node evals/probes/context-probe.mjs
 */

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const OLLAMA = process.env.OLLAMA_URL ?? 'http://localhost:11434';
const MODEL = process.env.OLLAMA_MODEL ?? 'qwen3:4b';

const SYSTEM =
  'You are a technical writer producing refresher material for a developer who has met the ' +
  'technology before. Work strictly from the supplied material. Report gaps rather than ' +
  'filling them from memory.';

/** The budgets as the pipeline actually sets them today. */
const BUDGETS = {
  researchSource: 8000, // research.ts DEFAULT_MAX_SOURCE_CHARS → primer-card
  comparePerSide: 4000, // compare.ts DEFAULT_MAX_SOURCE_CHARS → comparison-card
  claimsPerSide: 3000, // questions.ts MAX_MATERIAL_CHARS → contrastive-claims
};

const ARTICLES = ['Nginx', 'HAProxy', 'PostgreSQL', 'Kubernetes', 'Redis'];

const prompt = (path) => readFileSync(`src/main/llm/prompts/${path}`, 'utf8');
const render = (template, values) =>
  template.replace(/\{\{(\w+)\}\}/g, (whole, key) => values[key] ?? whole);

async function wikipediaExtract(article) {
  const url =
    `https://en.wikipedia.org/w/api.php?action=query&prop=extracts&explaintext=1` +
    `&format=json&redirects=1&titles=${encodeURIComponent(article)}`;
  const response = await fetch(url, { headers: { 'user-agent': 'skill-interview-probe/0.1' } });
  const body = await response.json();
  return Object.values((await body).query.pages)[0]?.extract ?? '';
}

/** Token count without paying for a full generation. */
async function measure(text, numCtx) {
  const started = Date.now();
  const response = await fetch(`${OLLAMA}/api/chat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      model: MODEL,
      stream: false,
      think: false,
      keep_alive: '5m',
      options: { num_ctx: numCtx, num_gpu: 99, num_predict: 1 },
      messages: [
        { role: 'system', content: SYSTEM },
        { role: 'user', content: text },
      ],
    }),
  });
  if (!response.ok) throw new Error(`ollama ${response.status}`);
  const body = await response.json();
  return {
    tokens: body.prompt_eval_count ?? 0,
    seconds: (Date.now() - started) / 1000,
  };
}

/** What Ollama says about where the model actually is. */
function placement() {
  try {
    const out = execFileSync('ollama', ['ps'], { encoding: 'utf8' });
    const line = out.split('\n').find((l) => l.includes(MODEL));
    return line ? line.replace(/\s{2,}/g, ' | ').trim() : 'not loaded';
  } catch {
    return 'unavailable';
  }
}

async function main() {
  console.log('fetching real articles…');
  const texts = {};
  for (const article of ARTICLES) texts[article] = await wikipediaExtract(article);

  console.log('\n--- what search actually returns ---');
  for (const [article, text] of Object.entries(texts)) {
    const overRun = text.length > BUDGETS.researchSource;
    console.log(
      `${article.padEnd(12)} ${String(text.length).padStart(6)} chars` +
        `${overRun ? `  → truncated to ${BUDGETS.researchSource}` : ''}`,
    );
  }

  const cut = (article, n) => texts[article].slice(0, n);

  const cases = [
    {
      label: 'primer-card (1 source)',
      text: render(prompt('primer-card.v1.md'), {
        SKILL: 'nginx',
        SOURCE: cut('Nginx', BUDGETS.researchSource),
        LANGUAGE: 'English',
      }),
    },
    {
      label: 'comparison-card (2 sides)',
      text: render(prompt('comparison-card.v1.md'), {
        SKILL_A: 'nginx',
        SKILL_B: 'HAProxy',
        MATERIAL_A: cut('Nginx', BUDGETS.comparePerSide),
        MATERIAL_B: cut('HAProxy', BUDGETS.comparePerSide),
        LANGUAGE: 'English',
      }),
    },
    {
      label: 'contrastive-claims (2 sides)',
      text: render(prompt('contrastive-claims.v1.md'), {
        SKILL_A: 'nginx',
        SKILL_B: 'HAProxy',
        MATERIAL_A: cut('Nginx', BUDGETS.claimsPerSide),
        MATERIAL_B: cut('HAProxy', BUDGETS.claimsPerSide),
        LANGUAGE: 'English',
      }),
    },
    {
      label: 'resolve-source (5 candidates)',
      text: render(prompt('resolve-source.v1.md'), {
        SKILL: 'Redis',
        CANDIDATES: ARTICLES.map((a, i) => `[${i}] ${a}\n${texts[a].slice(0, 400)}`).join('\n\n'),
      }),
    },
    {
      label: 'classify-skill',
      text: render(prompt('classify-skill.v1.md'), {
        SKILL: 'nginx',
        MATERIAL: cut('Nginx', 2000),
        SOURCE: cut('Nginx', 2000),
      }),
    },
  ];

  console.log('\n--- prompt sizes against num_ctx 4096 ---');
  let worst = 0;
  for (const one of cases) {
    const { tokens } = await measure(one.text, 4096);
    worst = Math.max(worst, tokens);
    const ratio = (one.text.length / Math.max(tokens, 1)).toFixed(2);
    const verdict = tokens >= 4096 ? 'OVERFLOWS — silently truncated' : `${4096 - tokens} spare`;
    console.log(
      `${one.label.padEnd(30)} ${String(one.text.length).padStart(6)} chars  ` +
        `${String(tokens).padStart(5)} tok  (${ratio} chars/tok)  ${verdict}`,
    );
  }
  console.log(`\nlargest prompt measured: ${worst} tokens`);

  console.log('\n--- what a larger window costs ---');
  for (const numCtx of [4096, 8192]) {
    const { tokens, seconds } = await measure(cases[1].text, numCtx);
    console.log(`num_ctx ${String(numCtx).padStart(5)}: ${tokens} tok in ${seconds.toFixed(1)}s`);
    console.log(`             ${placement()}`);
  }

  await fetch(`${OLLAMA}/api/chat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ model: MODEL, keep_alive: 0, messages: [] }),
  });
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

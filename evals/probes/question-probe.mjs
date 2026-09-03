/**
 * Question probe — does the discrimination gate leave anything to ask about?
 *
 * M-4's assembly is covered by tests against a stub, which proves the mechanism and says
 * nothing about the two things only a real model can settle ([TD-11], [TD-12]):
 *
 *   1. Does the claim prompt produce statements specific enough to be worth reading, or
 *      does it return "is open source" four times?
 *   2. How often does the gate discard a usable distractor? It rejects on uncertainty by
 *      design, and "correctly strict" and "so strict nothing survives" look identical
 *      from outside — both produce no questions.
 *
 * The subjects are three reverse proxies on purpose. They are the hardest case the gate
 * will meet: near-identical tools whose true statements overlap heavily, which is exactly
 * the condition that produces a question with two correct options.
 *
 * Uses the real prompt files, so a prompt edit changes what is measured.
 *
 *   ollama serve
 *   node evals/probes/question-probe.mjs
 */

import { readFileSync } from 'node:fs';

const OLLAMA = process.env.OLLAMA_URL ?? 'http://localhost:11434';
const MODEL = process.env.OLLAMA_MODEL ?? 'qwen3:4b';

const SYSTEM =
  'You are a technical writer producing refresher material for a developer who has met the ' +
  'technology before. Work strictly from the supplied material. Report gaps rather than ' +
  'filling them from memory.';

/** Three tools that do the same job. If the gate survives these, it survives anything. */
const SUBJECTS = [
  { skill: 'nginx', article: 'Nginx' },
  { skill: 'HAProxy', article: 'HAProxy' },
  { skill: 'Apache HTTP Server', article: 'Apache_HTTP_Server' },
];

const MAX_MATERIAL = 4000;

const prompt = (path) => readFileSync(`src/main/llm/prompts/${path}`, 'utf8');
const render = (template, values) =>
  template.replace(/\{\{(\w+)\}\}/g, (whole, key) => values[key] ?? whole);

async function generate(text, schema) {
  const response = await fetch(`${OLLAMA}/api/chat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      model: MODEL,
      stream: false,
      think: false,
      keep_alive: '5m',
      format: schema,
      options: { num_ctx: 4096, num_gpu: 99 },
      messages: [
        { role: 'system', content: SYSTEM },
        { role: 'user', content: text },
      ],
    }),
  });
  if (!response.ok) throw new Error(`ollama ${response.status}`);
  const body = await response.json();
  return JSON.parse(body.message.content);
}

async function wikipediaExtract(article) {
  const url =
    `https://en.wikipedia.org/w/api.php?action=query&prop=extracts&explaintext=1` +
    `&format=json&redirects=1&titles=${encodeURIComponent(article)}`;
  const response = await fetch(url, { headers: { 'user-agent': 'skill-interview-probe/0.1' } });
  const body = await response.json();
  const pages = Object.values(body.query.pages);
  const extract = pages[0]?.extract ?? '';
  return extract.slice(0, MAX_MATERIAL);
}

/** Mirrors question-validate.ts: whole-word match, so "Go" does not hit "going". */
const tokenize = (text) =>
  text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}+#]+/gu, ' ')
    .trim()
    .split(' ')
    .filter(Boolean);

function mentions(text, name) {
  const haystack = tokenize(text);
  const needle = tokenize(name);
  if (!needle.length || needle.length > haystack.length) return false;
  for (let i = 0; i <= haystack.length - needle.length; i += 1) {
    if (needle.every((token, j) => haystack[i + j] === token)) return true;
  }
  return false;
}

const CLAIMS_SCHEMA = {
  type: 'object',
  properties: { claims: { type: 'array', items: { type: 'string' } } },
  required: ['claims'],
};

const GATE_SCHEMA = {
  type: 'object',
  properties: { couldBeTrue: { type: 'boolean' }, reason: { type: 'string' } },
  required: ['couldBeTrue', 'reason'],
};

const STEM_SCHEMA = {
  type: 'object',
  properties: { stem: { type: 'string' }, explanation: { type: 'string' } },
  required: ['stem', 'explanation'],
};

async function main() {
  const primerPrompt = prompt('primer-card.v1.md');
  const claimsPrompt = prompt('question-claims.v1.md');
  const gatePrompt = prompt('discriminate-claim.v1.md');
  const stemPrompt = prompt('question-stem.v1.md');

  const built = [];

  for (const subject of SUBJECTS) {
    const source = await wikipediaExtract(subject.article);
    if (source.length < 500) {
      console.log(`  ${subject.skill}: no usable article, skipped`);
      continue;
    }

    const started = Date.now();
    const primer = await generate(
      render(primerPrompt, { SKILL: subject.skill, SOURCE: source, LANGUAGE: 'English' }),
      {
        type: 'object',
        properties: { title: { type: 'string' }, body: { type: 'string' } },
        required: ['title', 'body'],
      },
    );

    const raw = await generate(
      render(claimsPrompt, {
        SKILL: subject.skill,
        MATERIAL: primer.body.slice(0, MAX_MATERIAL),
        LANGUAGE: 'English',
      }),
      CLAIMS_SCHEMA,
    );

    const all = raw.claims.map((c) => c.trim()).filter(Boolean);
    const usable = all.filter((c) => !mentions(c, subject.skill));

    console.log(
      `\n${subject.skill} — ${all.length} claims, ${all.length - usable.length} named ` +
        `themselves and were dropped (${((Date.now() - started) / 1000).toFixed(1)}s)`,
    );
    for (const claim of usable) console.log(`   · ${claim}`);

    // The gate judges against one of these. Which one is the question GATE_MATERIAL
    // isolates: a primer is a short distillation, so most things are simply absent from
    // it — and the prompt treats "not settled by the material" as grounds to reject.
    built.push({
      ...subject,
      material:
        (process.env.GATE_MATERIAL ?? 'primer') === 'source'
          ? source
          : primer.body.slice(0, MAX_MATERIAL),
      claims: usable,
    });
  }

  console.log('\n--- the discrimination gate ---');

  let offered = 0;
  let survived = 0;
  const survivors = new Map();

  for (const target of built) {
    const pool = built
      .filter((s) => s.skill !== target.skill)
      .flatMap((s) => s.claims.map((text) => ({ text, from: s.skill })));
    const kept = [];

    for (const candidate of pool) {
      offered += 1;
      const verdict = await generate(
        render(gatePrompt, {
          SKILL: target.skill,
          MATERIAL: target.material,
          CLAIM: candidate.text,
        }),
        GATE_SCHEMA,
      );
      if (!verdict.couldBeTrue) {
        survived += 1;
        kept.push(candidate);
      }
    }

    survivors.set(target.skill, kept);
    const rate = pool.length ? ((kept.length / pool.length) * 100).toFixed(0) : '—';
    const enough = kept.length >= 3 ? 'enough' : 'NOT ENOUGH';
    console.log(`${target.skill}: ${kept.length}/${pool.length} survived (${rate}%) — ${enough}`);
  }

  console.log(
    `\noverall survival: ${survived}/${offered} ` +
      `(${offered ? ((survived / offered) * 100).toFixed(0) : 0}%)`,
  );

  console.log('\n--- one assembled question ---');
  const target = built.find((s) => (survivors.get(s.skill) ?? []).length >= 3);
  if (!target) {
    console.log('none — the gate left no skill with three usable distractors');
    return;
  }

  const distractors = survivors.get(target.skill).slice(0, 3);
  const correct = target.claims[0];
  const question = await generate(
    render(stemPrompt, {
      SKILL: target.skill,
      CORRECT: correct,
      DISTRACTORS: distractors.map((d) => `- ${d.text}  (describes ${d.from})`).join('\n'),
      LANGUAGE: 'English',
    }),
    STEM_SCHEMA,
  );

  console.log(`\n${question.stem}\n`);
  for (const option of [{ text: correct, from: target.skill, correct: true }, ...distractors]) {
    console.log(`  ${option.correct ? '✓' : ' '} ${option.text}   [${option.from}]`);
  }
  console.log(`\n${question.explanation}`);

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

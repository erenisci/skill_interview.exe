/**
 * Question probe — does a pair of similar technologies separate into usable options?
 *
 * The first version measured a separate discrimination gate, which judged borrowed claims
 * after the fact. It left 1 of 28 standing, because it could reject only where the
 * material explicitly contradicted a claim, and material about one technology is silent
 * about nearly everything another one does (ADR-0004's correction). Separation now happens
 * during generation with both technologies in view, and this measures that instead.
 *
 * The subjects are three reverse proxies on purpose: near-identical tools whose true
 * statements overlap heavily, which is the condition that produces a question with two
 * correct options. If a pair genuinely does not separate, empty arrays are the honest
 * answer and the probe reports it rather than counting it as failure.
 *
 * The numbers say whether enough options exist. Whether the wrong ones are actually false
 * of the target is not machine-checkable, so every claim is printed to be read.
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

/**
 * Four tools that do the same job — the hardest case, and four rather than three because
 * a pair yields about one usable claim per side, so three wrong answers need three
 * neighbours.
 */
const SUBJECTS = [
  { skill: 'nginx', article: 'Nginx' },
  { skill: 'HAProxy', article: 'HAProxy' },
  { skill: 'Apache HTTP Server', article: 'Apache_HTTP_Server' },
  { skill: 'Caddy', article: 'Caddy_(web_server)' },
];

const MAX_SOURCE = 4000;
const MAX_MATERIAL = 3000;
const NL = '\n';

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
  return (pages[0]?.extract ?? '').slice(0, MAX_SOURCE);
}

/** Mirrors question-validate.ts: whole-word match, so "Go" does not hit "going". */
const tokenize = (text) =>
  text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}+#]+/gu, ' ')
    .trim()
    .split(' ')
    .filter(Boolean);

/** Mirrors question-validate.ts: a name used as the subject is a prefix, not a flaw. */
function stripLeadingSubject(text, names) {
  const trimmed = text.trim();
  for (const name of names) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const leading = new RegExp(`^(the\\s+)?${escaped}(['’]s)?\\s+`, 'i');
    if (leading.test(trimmed)) return trimmed.replace(leading, '');
  }
  return trimmed;
}

function mentions(text, name) {
  const haystack = tokenize(text);
  const needle = tokenize(name);
  if (!needle.length || needle.length > haystack.length) return false;
  for (let i = 0; i <= haystack.length - needle.length; i += 1) {
    if (needle.every((token, j) => haystack[i + j] === token)) return true;
  }
  return false;
}

const PRIMER_SCHEMA = {
  type: 'object',
  properties: { title: { type: 'string' }, body: { type: 'string' } },
  required: ['title', 'body'],
};

const CONTRASTIVE_SCHEMA = {
  type: 'object',
  properties: {
    aClaims: { type: 'array', items: { type: 'string' } },
    bClaims: { type: 'array', items: { type: 'string' } },
  },
  required: ['aClaims', 'bClaims'],
};

const STEM_SCHEMA = {
  type: 'object',
  properties: { stem: { type: 'string' }, explanation: { type: 'string' } },
  required: ['stem', 'explanation'],
};

async function writePrimers(primerPrompt) {
  const built = [];
  for (const subject of SUBJECTS) {
    const source = await wikipediaExtract(subject.article);
    if (source.length < 500) {
      console.log(`${subject.skill}: no usable article, skipped`);
      continue;
    }
    const primer = await generate(
      render(primerPrompt, { SKILL: subject.skill, SOURCE: source, LANGUAGE: 'English' }),
      PRIMER_SCHEMA,
    );
    built.push({ ...subject, material: primer.body.slice(0, MAX_MATERIAL) });
    console.log(`primer written for ${subject.skill}`);
  }
  return built;
}

async function separate(pairPrompt, a, b) {
  const started = Date.now();
  const raw = await generate(
    render(pairPrompt, {
      SKILL_A: a.skill,
      MATERIAL_A: a.material,
      SKILL_B: b.skill,
      MATERIAL_B: b.material,
      LANGUAGE: 'English',
    }),
    CONTRASTIVE_SCHEMA,
  );

  const names = [a.skill, b.skill];
  const clean = (list) =>
    (list ?? [])
      .map((claim) => stripLeadingSubject(claim, names))
      .filter(Boolean)
      .filter((claim) => !names.some((name) => mentions(claim, name)));

  const aClaims = clean(raw.aClaims);
  const bClaims = clean(raw.bClaims);
  const named =
    (raw.aClaims ?? []).length + (raw.bClaims ?? []).length - aClaims.length - bClaims.length;

  return { aClaims, bClaims, named, seconds: ((Date.now() - started) / 1000).toFixed(1) };
}

/** Mirrors questions.ts: one wrong answer per neighbour before a second from any. */
function spread(claims) {
  const seen = new Set();
  const first = [];
  const rest = [];
  for (const claim of claims) {
    if (seen.has(claim.from)) rest.push(claim);
    else {
      seen.add(claim.from);
      first.push(claim);
    }
  }
  return [...first, ...rest];
}

async function main() {
  const primerPrompt = prompt('primer-card.v1.md');
  const pairPrompt = prompt('contrastive-claims.v1.md');
  const stemPrompt = prompt('question-stem.v1.md');

  const built = await writePrimers(primerPrompt);

  console.log(NL + '--- pairwise separation ---');

  let usablePairs = 0;
  let totalPairs = 0;
  const askable = [];
  /** Claims true of a skill, and claims written to be false of it. */
  const own = new Map(built.map((s) => [s.skill, []]));
  const against = new Map(built.map((s) => [s.skill, []]));

  for (let i = 0; i < built.length; i += 1) {
    for (let j = i + 1; j < built.length; j += 1) {
      const a = built[i];
      const b = built[j];
      totalPairs += 1;

      const { aClaims, bClaims, named, seconds } = await separate(pairPrompt, a, b);

      console.log(
        NL +
          `${a.skill} vs ${b.skill} — ${aClaims.length}/${bClaims.length} claims, ` +
          `${named} named a technology and were dropped (${seconds}s)`,
      );
      for (const claim of aClaims) console.log(`   ${a.skill} · ${claim}`);
      for (const claim of bClaims) console.log(`   ${b.skill} · ${claim}`);

      if (aClaims.length > 0 && bClaims.length > 0) usablePairs += 1;

      // Claims are pooled per subject, not per pair. Wrong answers come from the whole
      // skill list, so one claim from each of three neighbours is a complete question.
      for (const claim of aClaims) {
        own.get(a.skill).push(claim);
        against.get(b.skill).push({
          text: claim,
          from: a.skill,
        });
      }
      for (const claim of bClaims) {
        own.get(b.skill).push(claim);
        against.get(a.skill).push({
          text: claim,
          from: b.skill,
        });
      }
    }
  }

  console.log(NL + `pairs that separated at all: ${usablePairs}/${totalPairs}`);
  console.log(NL + '--- pooled across neighbours ---');

  let askableSubjects = 0;
  for (const subject of built) {
    const mine = own.get(subject.skill) ?? [];
    const wrong = against.get(subject.skill) ?? [];
    const can = mine.length >= 1 && wrong.length >= 3;
    if (can) {
      askableSubjects += 1;
      askable.push({
        subject,
        correct: mine[0],
        distractors: spread(wrong).slice(0, 3),
      });
    }
    console.log(
      `${subject.skill}: ${mine.length} own · ${wrong.length} wrong answers available — ` +
        `${can ? 'can ask' : 'cannot'}`,
    );
  }

  console.log(NL + `skills that can be asked about: ${askableSubjects}/${built.length}`);
  console.log(NL + '--- assembled questions ---');

  if (askable.length === 0) {
    console.log('none — no pair separated far enough');
    return;
  }

  for (const pair of askable.slice(0, 3)) {
    const question = await generate(
      render(stemPrompt, {
        SKILL: pair.subject.skill,
        CORRECT: pair.correct,
        DISTRACTORS: pair.distractors
          .map((claim) => `- ${claim.text}  (describes ${claim.from})`)
          .join(NL),
        LANGUAGE: 'English',
      }),
      STEM_SCHEMA,
    );

    console.log(NL + question.stem);
    console.log(`  [correct] ${pair.correct}   (${pair.subject.skill})`);
    for (const claim of pair.distractors)
      console.log(`            ${claim.text}   (${claim.from})`);
    console.log(`  ${question.explanation}`);
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

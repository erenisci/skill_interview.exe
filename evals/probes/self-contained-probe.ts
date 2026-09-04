/**
 * Can a skill be asked about **without** a sibling to borrow wrong answers from?
 *
 * This is the question item 4 of the working plan turns on, and it must be measured before
 * anything is built on it. Today a question needs three claims written against the skill by
 * its graph neighbours, so a skill with no neighbours can never be asked about — which is
 * why Redis and Python produced nothing on a real database.
 *
 * The obvious alternative is to have the model invent the wrong answers. **That was already
 * measured and it failed**: ADR-0006 records a gate that judged borrowed claims after the
 * fact and left 1 of 28 standing, because material about one technology is silent about
 * nearly everything another one does.
 *
 * What made the pairwise design work was moving the separation *into* generation, with both
 * subjects in view. This probe applies the same lever to a single subject: for one fact in
 * the material, ask for the true statement **and three near-misses of it in the same call** —
 * a changed mechanism, a reversed direction, a wrong default. The model never has to judge
 * its own output afterwards, which is the step that failed.
 *
 * What is scored here is only what a machine can settle: schema conformance, that the
 * distractors differ from the truth and from each other, that nothing names its own subject,
 * and that the options are close enough in length not to give the answer away. **Whether a
 * distractor is genuinely false is left to a human** — an LLM judging this inherits exactly
 * the failure being tested for.
 *
 *   npx vite-node --config vitest.config.ts evals/probes/self-contained-probe.ts
 */
import { z } from 'zod';
import { OllamaLlmAdapter } from '../../src/main/llm/ollama';
import { SYSTEM_PREAMBLE } from '../../src/main/llm/prompts';
import { structured } from '../../src/main/llm/schema';
import { mentions, normalizeClaim } from '../../src/main/pipeline/question-validate';
import { loadSource } from '../harness/sets';

const MAX_MATERIAL = 3_000;
const MAX_LENGTH_RATIO = 2.5;

const SelfContainedSchema = structured(
  'self-contained-claims',
  z.object({
    items: z.array(
      z.object({
        truth: z.string(),
        distractors: z.array(z.string()),
      }),
    ),
  }),
);

const PROMPT = `You are writing multiple-choice material about one technology, from the material below.

For each item, write **one true statement** about {{SKILL}} and **three false ones**.

The three false statements are the hard part, and they are what this is for:

- Each must be the true statement with **one part replaced by something else** — a different
  mechanism, the opposite direction, another default. Same shape, same length, one word or
  phrase swapped.
- **Never make a false statement by adding to the true one.** Adding a qualifier to something
  true leaves it true: "handles many concurrent users" and "handles many concurrent users and
  offers high availability" are both correct, so the second is not a wrong answer. Every false
  statement must *replace*, never extend.
- The replacement must make the statement wrong on its own terms. If the technology also does
  the thing you swapped in, you have written a second true answer — pick something it does not
  do.
- Each must be **clearly false** of {{SKILL}} to someone who knows it. Not vague, not
  "arguably", not a detail the material happens not to mention — actually wrong.
- Each must be plausible to someone who does not know it. A false statement nobody would pick
  teaches nothing.

Rules that apply to every statement, true or false:

1. **Never name {{SKILL}}**, or anything that identifies it — no product names, no command
   names, no company names. A statement that names its subject hands over the answer.
2. State a mechanism, a guarantee, or a behaviour. Not history, not version numbers, not
   popularity, not licensing. Those test whether someone has memorised trivia.
3. Keep all four roughly the same length. A conspicuously longer option is a tell.
4. Each is one self-contained sentence, read alone.

Everything true must come from the MATERIAL. If the material does not support a fact, do not
invent one — write fewer items. Three solid items beat eight padded ones.

TECHNOLOGY: {{SKILL}}

MATERIAL:
{{MATERIAL}}

Return \`items\`, each with a \`truth\` and exactly three \`distractors\`.`;

const llm = new OllamaLlmAdapter({
  url: process.env['OLLAMA_URL'] ?? 'http://localhost:11434',
  model: process.env['OLLAMA_MODEL'] ?? 'qwen3:4b',
});

const CASES = [
  ['nginx', 'nginx.txt'],
  ['Redis', 'redis.txt'],
  ['PostgreSQL', 'postgresql.txt'],
  ['HAProxy', 'haproxy.txt'],
] as const;

let usable = 0;
let produced = 0;
const failures: string[] = [];

for (const [skill, file] of CASES) {
  console.log(`\n=== ${skill} ===`);

  const material = loadSource(file).slice(0, MAX_MATERIAL);
  const generated = await llm.generate({
    system: SYSTEM_PREAMBLE,
    prompt: PROMPT.replaceAll('{{SKILL}}', skill).replace('{{MATERIAL}}', material),
    schema: SelfContainedSchema,
  });

  if (!generated.ok) {
    console.log(`  GENERATION FAILED: ${generated.error.message}`);
    failures.push(`${skill}: ${generated.error.code}`);
    continue;
  }

  for (const item of generated.value.value.items) {
    produced += 1;
    const options = [item.truth, ...item.distractors];
    const reasons: string[] = [];

    if (item.distractors.length !== 3)
      reasons.push(`${String(item.distractors.length)} distractors`);
    if (options.some((text) => mentions(text, skill))) reasons.push('names its own subject');

    const normalized = options.map(normalizeClaim);
    if (new Set(normalized).size !== normalized.length) reasons.push('duplicate options');

    const lengths = options.map((text) => text.length);
    const ratio = Math.max(...lengths) / Math.max(1, Math.min(...lengths));
    if (ratio > MAX_LENGTH_RATIO) reasons.push(`length ratio ${ratio.toFixed(1)}`);

    if (reasons.length === 0) usable += 1;
    console.log(`\n  ${reasons.length === 0 ? 'USABLE' : 'DROPPED — ' + reasons.join(', ')}`);
    console.log(`    ✓ ${item.truth}`);
    for (const distractor of item.distractors) console.log(`    ✗ ${distractor}`);
  }
}

await llm.release();
console.log(
  `\n${String(usable)}/${String(produced)} items pass the mechanical checks` +
    (failures.length > 0 ? ` · generation failed for: ${failures.join(', ')}` : ''),
);
console.log('Whether each ✗ is genuinely false is for a person to say — that is the whole risk.');

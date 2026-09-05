/**
 * Can one skill be asked about on its own, if the **question comes first**?
 *
 * `self-contained-probe.ts` measured a weaker shape and concluded it could not: given only
 * material, the model was asked for a true statement and three false ones, and about half
 * the "false" ones were true. But that asks the model to judge falsity as a property of the
 * world — "is this sentence wrong about Redis?" — which is the hard version, and the same
 * judgement ADR-0006 already measured into the ground.
 *
 * People do not write multiple-choice questions that way. The stem comes first, and it makes
 * wrongness **relative to the question**:
 *
 *     How does it handle concurrent connections?
 *       an event loop over non-blocking sockets   ← correct
 *       one thread per connection                 ← a real mechanism, wrong here
 *       one process per connection                ← a real mechanism, wrong here
 *       a thread pool per virtual host            ← a real mechanism, wrong here
 *
 * Every wrong option is a true thing about software in general and plainly wrong as *this*
 * answer. The model never has to decide whether a sentence is globally false, only which of
 * four answers the material supports — which is the judgement it makes well.
 *
 * Scored mechanically here; whether an option is genuinely wrong is for a person to read.
 *
 *   npx vite-node --config vitest.config.ts evals/probes/stem-first-probe.ts
 */
import { z } from 'zod';
import { OllamaLlmAdapter } from '../../src/main/llm/ollama';
import { SYSTEM_PREAMBLE } from '../../src/main/llm/prompts';
import { structured } from '../../src/main/llm/schema';
import {
  looksLikeTrivia,
  mentions,
  normalizeClaim,
} from '../../src/main/pipeline/question-validate';
import { loadSource } from '../harness/sets';

const MAX_MATERIAL = 3_000;
const MAX_LENGTH_RATIO = 2.5;

const StemFirstSchema = structured(
  'stem-first-questions',
  z.object({
    questions: z.array(
      z.object({
        stem: z.string(),
        correct: z.string(),
        wrong: z.array(z.string()),
        explanation: z.string(),
      }),
    ),
  }),
);

const PROMPT = `You are writing interview questions about {{SKILL}}, from the material below.

Write each question the way an interviewer would: ask how something works, then offer four
answers of which exactly one is right.

The three wrong answers are the craft. Each must be:

- **A real mechanism**, the kind of thing some other software genuinely does. "One thread per
  connection" and "one process per connection" are both real designs. An invented answer is
  obvious and teaches nothing.
- **Wrong as the answer to this question.** It does not have to be false everywhere — it has
  to be not what {{SKILL}} does here. This is the whole reason the question comes first.
- **The same kind of thing as the right answer.** If the right answer names a strategy, the
  wrong ones name strategies. If it names a guarantee, they name guarantees.

Rules for every question:

1. The stem may name {{SKILL}} — that is how an interviewer asks. **No option may name it**, or
   anything that identifies it: an option that names its own technology hands over the answer.
2. Ask about a mechanism, a guarantee, or a behaviour — how it works, what it promises, what
   it refuses to do. Not when it was released, who wrote it, what licence it uses, or how
   popular it is. Those test recall, not understanding.
3. All four options roughly the same length. A longer option is a tell.
4. The right answer must be supported by the MATERIAL. If the material does not say how
   something works, do not write that question — write fewer.

Write between 0 and 5 questions. Three good ones beat eight padded ones.

TECHNOLOGY: {{SKILL}}

MATERIAL:
{{MATERIAL}}

Return \`questions\`, each with a \`stem\`, the \`correct\` answer, three \`wrong\` answers, and an
\`explanation\` of why the correct one is correct.`;

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

for (const [skill, file] of CASES) {
  console.log(`\n=== ${skill} ===`);

  const generated = await llm.generate({
    system: SYSTEM_PREAMBLE,
    prompt: PROMPT.replaceAll('{{SKILL}}', skill).replace(
      '{{MATERIAL}}',
      loadSource(file).slice(0, MAX_MATERIAL),
    ),
    schema: StemFirstSchema,
  });

  if (!generated.ok) {
    console.log(`  GENERATION FAILED: ${generated.error.message}`);
    continue;
  }

  for (const item of generated.value.value.questions) {
    produced += 1;
    const options = [item.correct, ...item.wrong];
    const reasons: string[] = [];

    if (item.wrong.length !== 3) reasons.push(`${String(item.wrong.length)} wrong answers`);
    // The naming rule belongs to the options, not to the stem. "How does PostgreSQL handle
    // concurrency?" is an ordinary interview question; an *option* that names its own
    // technology is what hands over the answer.
    if (options.some((text) => mentions(text, skill))) reasons.push('an option names the subject');
    if (looksLikeTrivia(item.stem) || options.some(looksLikeTrivia)) reasons.push('trivia');

    const normalized = options.map(normalizeClaim);
    if (new Set(normalized).size !== normalized.length) reasons.push('duplicate options');

    const lengths = options.map((text) => text.length);
    const ratio = Math.max(...lengths) / Math.max(1, Math.min(...lengths));
    if (ratio > MAX_LENGTH_RATIO) reasons.push(`length ratio ${ratio.toFixed(1)}`);

    if (reasons.length === 0) usable += 1;
    console.log(`\n  ${reasons.length === 0 ? 'USABLE' : 'DROPPED — ' + reasons.join(', ')}`);
    console.log(`    Q: ${item.stem}`);
    console.log(`    ✓ ${item.correct}`);
    for (const wrong of item.wrong) console.log(`    ✗ ${wrong}`);
  }
}

await llm.release();
console.log(`\n${String(usable)}/${String(produced)} pass the mechanical checks.`);
console.log('Whether each ✗ is wrong *for its question* is for a person to read.');

/**
 * Drives the real pipeline against the real database, headlessly.
 *
 * Not a test and not part of any suite: it is the app's own context, its own handlers and a
 * real model, run without a window so a session can be set up and then looked at. Everything
 * it writes is what the app itself would have written.
 *
 * The queue is stepped by hand rather than started, so each job is visible as it happens and
 * the run ends when there is genuinely nothing left rather than after a timer.
 *
 *   npx vite-node --config vitest.config.ts evals/probes/live-run.ts
 */
import { createContext } from '../../src/main/context';
import { toSlug } from '../../src/main/util/slug';

const SKILLS = ['JavaScript', 'TypeScript', 'Python', 'Java'] as const;
const CARDS_PER_SKILL = 1;
const QUESTIONS_PER_SKILL = 3;

const dataDir = `${process.env['APPDATA'] ?? ''}/skill-interview`;
const ctx = createContext(dataDir);

const model = process.env['OLLAMA_MODEL'] ?? 'qwen3:4b';
ctx.settings.set('ollama_model', model);
console.log(`model: ${model}\ndata:  ${dataDir}\n`);

for (const name of SKILLS) {
  const now = new Date().toISOString();
  const existing = ctx.skills.findBySlug(toSlug(name));
  if (existing) {
    console.log(`- ${name} already tracked (id ${String(existing.id)})`);
    continue;
  }
  const skill = ctx.skills.insert({ name, slug: toSlug(name), contentLang: 'en', createdAt: now });
  ctx.skills.setDailyLimits(skill.id, CARDS_PER_SKILL, QUESTIONS_PER_SKILL);
  ctx.jobs.enqueue('research', { skillId: skill.id }, now);
  console.log(`+ ${name} (id ${String(skill.id)})`);
}

console.log('\nworking the queue…\n');

let step = 0;
for (;;) {
  // `StepResult` is a plain string, not an object — reading `.kind` off it is always
  // undefined, which spins until the cap and reports a drain failure that never happened.
  const result = await ctx.queue.runOnce();
  if (result === 'idle') break;
  step += 1;
  if (step > 200) {
    console.log('stopping: 200 steps without draining, which is a bug rather than a long run');
    break;
  }
}

console.log(`\n${String(step)} jobs run.\n`);

for (const skill of ctx.skills.list()) {
  const cards = ctx.cards.listBySkill(skill.id);
  const questions = ctx.questions.listBySkill(skill.id);
  const related = ctx.relations.listFor(skill.id).length;
  console.log(
    `${skill.name}: ${skill.status}, category ${skill.category ?? 'none'}, ` +
      `${String(cards.length)} card(s), ${String(questions.length)} question(s), ` +
      `${String(related)} neighbour(s)`,
  );
  for (const question of questions) {
    console.log(`\n  Q: ${question.stem}   [${question.promptVersion}]`);
    for (const option of question.options) {
      const from = option.sourceSkillId === null ? '' : ' ←borrowed';
      console.log(`     ${option.isCorrect ? '✓' : '✗'} ${option.text}${from}`);
    }
  }
  console.log('');
}

await ctx.queue.stop();
ctx.db.close();

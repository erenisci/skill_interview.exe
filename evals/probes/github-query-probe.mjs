/**
 * GitHub query-strategy probe — a one-off measurement, not product code.
 *
 * Question it answers: which search strategy actually resolves a skill name to the
 * repository *of* that project rather than one merely mentioning it?
 *
 * It exists because ADR-0003 named `in:name` as the fix for the precision failures found
 * by `precision-probe.mjs`, and that claim had never been measured. It does not hold: the
 * culprit was `sort=stars` alone, and `in:name` scores worse than plain relevance.
 */

const UA = 'skill-interview-query-probe/0.1 (one-off evaluation; contact: repo owner)';
const BASE = 'https://api.github.com/search/repositories?per_page=1&q=';

/** Mixed on purpose: the ambiguous names that failed before, plus ones that never did. */
const SKILLS = ['Redis', 'Vitest', 'tRPC', 'Express.js', 'Zustand', 'Traefik', 'nginx'];

/** Unauthenticated GitHub search allows ~10 requests a minute. */
const THROTTLE_MS = 7000;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function top(url) {
  try {
    const res = await fetch(url, {
      headers: { 'user-agent': UA, accept: 'application/vnd.github+json' },
    });
    if (!res.ok) return `http ${res.status}`;
    const body = await res.json();
    return body.items?.[0]?.full_name ?? '(none)';
  } catch (e) {
    return `error: ${String(e.message || e)}`;
  }
}

const pad = (s, n) => String(s).padEnd(n);

console.log(pad('skill', 12) + pad('sort=stars', 26) + pad('relevance', 25) + 'in:name');
console.log('-'.repeat(96));

for (const skill of SKILLS) {
  const stars = await top(`${BASE}${encodeURIComponent(skill)}&sort=stars&order=desc`);
  await sleep(THROTTLE_MS);
  const relevance = await top(`${BASE}${encodeURIComponent(skill)}`);
  await sleep(THROTTLE_MS);
  const inName = await top(`${BASE}${encodeURIComponent(`${skill} in:name`)}`);
  await sleep(THROTTLE_MS);

  console.log(pad(skill, 12) + pad(stars, 26) + pad(relevance, 25) + inName);
}

console.log(`
Read the columns, not a score: the question is whether the top hit is the project itself.
Measured 2026-09-03 — sort=stars 2/7, relevance 7/7, in:name 6/7.
`);

/**
 * Search coverage probe — a one-off measurement, not product code.
 *
 * Question it answers: for the kind of skill a developer actually puts on a CV, which
 * provider returns enough usable text to ground a primer card? The doc set currently
 * assumes Wikipedia + DuckDuckGo; this checks whether that holds.
 *
 * Deliberately mixed list: established technologies Wikipedia covers well, and modern
 * tooling it may not cover at all. The interesting number is where the cliff is.
 */

const SKILLS = [
  // established — expected to be fine everywhere
  'Java',
  'Python',
  'Docker',
  'Kubernetes',
  'PostgreSQL',
  'Redis',
  'nginx',
  'Git',
  // mid-tier — real projects, less encyclopedic presence
  'Traefik',
  'WSL',
  'FastAPI',
  'Spring Boot',
  'Express.js',
  // modern tooling — the suspected cliff
  'pnpm',
  'Vitest',
  'tRPC',
  'Drizzle ORM',
  'Zustand',
  'Tauri',
  'HTMX',
];

const UA = 'skill-interview-coverage-probe/0.1 (one-off evaluation; contact: repo owner)';
const USABLE_CHARS = 1000; // rough bar for "enough to ground a 1-2 page primer"

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function stripHtml(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<nav[\s\S]*?<\/nav>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&[a-z]+;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

async function get(url, headers = {}, timeoutMs = 20000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      headers: { 'user-agent': UA, ...headers },
      signal: ctrl.signal,
      redirect: 'follow',
    });
    const text = await res.text();
    return { status: res.status, text };
  } catch (e) {
    return { status: 0, text: '', error: String(e.message || e) };
  } finally {
    clearTimeout(timer);
  }
}

/** Wikipedia: search for the page, then pull the plain-text extract. */
async function wikipedia(skill) {
  const search = await get(
    `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(skill)}&srlimit=1&format=json`,
  );
  if (search.status !== 200) return { ok: false, chars: 0, note: `search http ${search.status}` };
  let title;
  try {
    title = JSON.parse(search.text)?.query?.search?.[0]?.title;
  } catch {
    return { ok: false, chars: 0, note: 'search parse failed' };
  }
  if (!title) return { ok: false, chars: 0, note: 'no article' };

  const extract = await get(
    `https://en.wikipedia.org/w/api.php?action=query&prop=extracts&explaintext=1&redirects=1&titles=${encodeURIComponent(title)}&format=json`,
  );
  if (extract.status !== 200)
    return { ok: false, chars: 0, note: `extract http ${extract.status}` };
  try {
    const pages = JSON.parse(extract.text)?.query?.pages ?? {};
    const body = Object.values(pages)[0]?.extract ?? '';
    return { ok: body.length >= USABLE_CHARS, chars: body.length, note: `article: ${title}` };
  } catch {
    return { ok: false, chars: 0, note: 'extract parse failed' };
  }
}

/** GitHub: top repo by stars, then its README and homepage. */
async function github(skill) {
  const search = await get(
    `https://api.github.com/search/repositories?q=${encodeURIComponent(skill)}&sort=stars&order=desc&per_page=1`,
    { accept: 'application/vnd.github+json' },
  );
  if (search.status === 403 || search.status === 429) {
    return { ok: false, chars: 0, note: 'rate limited', homepage: null };
  }
  if (search.status !== 200)
    return { ok: false, chars: 0, note: `http ${search.status}`, homepage: null };

  let repo;
  try {
    repo = JSON.parse(search.text)?.items?.[0];
  } catch {
    return { ok: false, chars: 0, note: 'parse failed', homepage: null };
  }
  if (!repo) return { ok: false, chars: 0, note: 'no repo', homepage: null };

  const readme = await get(`https://raw.githubusercontent.com/${repo.full_name}/HEAD/README.md`);
  const body = readme.status === 200 ? readme.text : '';
  return {
    ok: body.length >= USABLE_CHARS,
    chars: body.length,
    note: `${repo.full_name} ★${repo.stargazers_count}`,
    homepage: repo.homepage || null,
  };
}

/** Official docs: whatever the repo declares as its homepage. */
async function officialDocs(homepage) {
  if (!homepage) return { ok: false, chars: 0, note: 'no homepage declared' };
  const res = await get(homepage);
  if (res.status !== 200) return { ok: false, chars: 0, note: `http ${res.status}` };
  const text = stripHtml(res.text);
  return {
    ok: text.length >= USABLE_CHARS,
    chars: text.length,
    note: new URL(homepage).host,
  };
}

/** DuckDuckGo HTML endpoint — no API contract, included precisely to see if it holds. */
async function duckduckgo(skill) {
  const res = await get(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(skill)}`);
  if (res.status !== 200) return { ok: false, chars: 0, note: `http ${res.status}` };
  const links = [...res.text.matchAll(/class="result__a"[^>]*href="([^"]+)"/g)].length;
  const blocked = /anomaly|captcha|unusual traffic/i.test(res.text);
  return {
    ok: links > 0 && !blocked,
    chars: links,
    note: blocked ? 'challenge page' : `${links} results`,
  };
}

const rows = [];

for (const skill of SKILLS) {
  process.stdout.write(`probing ${skill}… `);
  const wiki = await wikipedia(skill);
  const gh = await github(skill);
  const docs = await officialDocs(gh.homepage);
  const ddg = await duckduckgo(skill);
  rows.push({ skill, wiki, gh, docs, ddg });
  process.stdout.write(
    `wiki:${wiki.ok ? 'Y' : 'n'} gh:${gh.ok ? 'Y' : 'n'} docs:${docs.ok ? 'Y' : 'n'} ddg:${ddg.ok ? 'Y' : 'n'}\n`,
  );
  await sleep(7000); // unauthenticated GitHub search allows ~10/min
}

const pad = (s, n) => String(s).padEnd(n);
console.log('\n' + '='.repeat(96));
console.log(
  pad('skill', 14) +
    pad('wikipedia', 22) +
    pad('github readme', 26) +
    pad('official docs', 20) +
    'duckduckgo',
);
console.log('='.repeat(96));
for (const r of rows) {
  console.log(
    pad(r.skill, 14) +
      pad(`${r.wiki.ok ? 'OK' : '--'} ${r.wiki.chars}`, 22) +
      pad(`${r.gh.ok ? 'OK' : '--'} ${r.gh.chars}`, 26) +
      pad(`${r.docs.ok ? 'OK' : '--'} ${r.docs.chars}`, 20) +
      `${r.ddg.ok ? 'OK' : '--'} ${r.ddg.note}`,
  );
}

const pct = (f) => Math.round((rows.filter(f).length / rows.length) * 100);
console.log('\ncoverage (usable source text, >= ' + USABLE_CHARS + ' chars):');
console.log('  wikipedia      ' + pct((r) => r.wiki.ok) + '%');
console.log('  github readme  ' + pct((r) => r.gh.ok) + '%');
console.log('  official docs  ' + pct((r) => r.docs.ok) + '%');
console.log('  duckduckgo     ' + pct((r) => r.ddg.ok) + '%');
console.log('  github OR wiki ' + pct((r) => r.gh.ok || r.wiki.ok) + '%');
console.log('  any of the four ' + pct((r) => r.gh.ok || r.wiki.ok || r.docs.ok || r.ddg.ok) + '%');

console.log('\nskills with NO usable source from wikipedia:');
for (const r of rows.filter((x) => !x.wiki.ok)) console.log('  ' + r.skill + ' — ' + r.wiki.note);

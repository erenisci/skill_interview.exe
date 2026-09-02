/**
 * Precision probe — the question the coverage probe did not answer.
 *
 * Coverage asked "did text come back". This asks "is it text about the right thing".
 * Ambiguous names are the interesting case: Zustand is German for "state", Drizzle was
 * a MySQL fork years before the ORM, tRPC looks like generic RPC. A card grounded in the
 * wrong subject is confidently wrong, which is worse than an empty result.
 */

const SKILLS = [
  'Zustand',
  'Drizzle ORM',
  'Tauri',
  'tRPC',
  'Traefik',
  'Vitest',
  'Redis',
  'Express.js',
];

const UA = 'skill-interview-precision-probe/0.1 (one-off evaluation; contact: repo owner)';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function get(url, headers = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 20000);
  try {
    const res = await fetch(url, {
      headers: { 'user-agent': UA, ...headers },
      signal: ctrl.signal,
    });
    return { status: res.status, text: await res.text() };
  } catch (e) {
    return { status: 0, text: '', error: String(e.message || e) };
  } finally {
    clearTimeout(timer);
  }
}

async function wikipedia(skill) {
  const search = await get(
    `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(skill)}&srlimit=1&format=json`,
  );
  if (search.status !== 200) return { title: `(http ${search.status})`, lead: '' };
  const hit = JSON.parse(search.text)?.query?.search?.[0];
  if (!hit) return { title: '(no article)', lead: '' };

  await sleep(1500);
  const extract = await get(
    `https://en.wikipedia.org/w/api.php?action=query&prop=extracts&explaintext=1&exintro=1&redirects=1&titles=${encodeURIComponent(hit.title)}&format=json`,
  );
  const pages = extract.status === 200 ? (JSON.parse(extract.text)?.query?.pages ?? {}) : {};
  const lead = Object.values(pages)[0]?.extract ?? '';
  return { title: hit.title, lead: lead.replace(/\s+/g, ' ').slice(0, 190) };
}

async function github(skill) {
  const search = await get(
    `https://api.github.com/search/repositories?q=${encodeURIComponent(skill)}&sort=stars&order=desc&per_page=1`,
    { accept: 'application/vnd.github+json' },
  );
  if (search.status !== 200) return { repo: `(http ${search.status})`, desc: '' };
  const item = JSON.parse(search.text)?.items?.[0];
  if (!item) return { repo: '(no repo)', desc: '' };
  return {
    repo: `${item.full_name} ★${item.stargazers_count}`,
    desc: (item.description ?? '').replace(/\s+/g, ' ').slice(0, 190),
  };
}

for (const skill of SKILLS) {
  const wiki = await wikipedia(skill);
  await sleep(1500);
  const gh = await github(skill);

  console.log('\n' + '─'.repeat(94));
  console.log(`SKILL: ${skill}`);
  console.log(`  wikipedia -> ${wiki.title}`);
  console.log(`               ${wiki.lead || '(no lead text)'}`);
  console.log(`  github    -> ${gh.repo}`);
  console.log(`               ${gh.desc || '(no description)'}`);
  await sleep(6000); // GitHub search: ~10/min unauthenticated
}

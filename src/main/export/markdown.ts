import type { Favorite, Skill, Source } from '@shared/domain';
import type { FavoriteCard, FavoriteEntry, FavoriteQuestion, OrphanedFavorite } from '@shared/ipc';

/**
 * Favourites as one Markdown file, grouped by skill.
 *
 * Pure: dates, content and ordering all arrive as arguments, so the output is fully
 * determined by the input and can be asserted character for character. Choosing where the
 * file goes and writing it are the IPC layer's job — the only part that needs Electron.
 *
 * The format is written to be read outside this app — in a text editor, a gist, a
 * repository — which is the whole point of exporting at all. So: no HTML, no app-specific
 * syntax, and every source is a real link rather than a bare id the reader cannot follow.
 */

function escapeCell(text: string): string {
  return text.replace(/\|/g, '\\|');
}

function renderNote(favorite: Favorite): readonly string[] {
  if (!favorite.note) return [];
  return ['', `> **Note.** ${favorite.note}`];
}

function renderSources(sources: readonly Source[]): readonly string[] {
  if (sources.length === 0) return [];
  const links = sources.map((source) => {
    const licence = source.license ? ` (${source.license})` : '';
    return `[${escapeCell(source.title)}](${source.url})${licence}`;
  });
  return ['', `Sources: ${links.join(' · ')}`];
}

function renderCard(entry: FavoriteCard): readonly string[] {
  return [
    '',
    `### ${entry.card.title}`,
    '',
    entry.card.bodyMd.trim(),
    ...renderSources(entry.sources),
    ...renderNote(entry.favorite),
  ];
}

function renderQuestion(entry: FavoriteQuestion): readonly string[] {
  const options = entry.question.options.map((option) => {
    // The mark and the attribution together are the lesson: a wrong option here is a true
    // statement about a different technology, which is why it was plausible.
    const mark = option.isCorrect ? '**✓**' : '☐';
    const from = option.rationale ? ` — _${escapeCell(option.rationale)}_` : '';
    return `- ${mark} ${escapeCell(option.text)}${from}`;
  });

  return [
    '',
    `### ${entry.question.stem}`,
    '',
    ...options,
    '',
    entry.question.explanation.trim(),
    ...renderNote(entry.favorite),
  ];
}

function renderOrphan(entry: OrphanedFavorite): readonly string[] {
  const kept = entry.favorite.createdAt.slice(0, 10);
  return [
    '',
    `- A ${entry.favorite.itemType} kept on ${kept}. The skill it belonged to has since been removed, so its content is gone.`,
    ...(entry.favorite.note ? [`  Note: ${entry.favorite.note}`] : []),
  ];
}

/**
 * Groups by skill in the order skills are first met in `entries`, so the caller's ordering
 * decides the document's — this function does not impose one of its own.
 */
export function renderFavoritesMarkdown(
  entries: readonly FavoriteEntry[],
  exportedAt: Date,
): string {
  const bySkill = new Map<number, { skill: Skill; entries: (FavoriteCard | FavoriteQuestion)[] }>();
  const orphans: OrphanedFavorite[] = [];

  for (const entry of entries) {
    if (entry.kind === 'orphaned') {
      orphans.push(entry);
      continue;
    }
    const group = bySkill.get(entry.skill.id);
    if (group) group.entries.push(entry);
    else bySkill.set(entry.skill.id, { skill: entry.skill, entries: [entry] });
  }

  const kept = entries.length;
  const lines: string[] = [
    '# Favourites',
    '',
    `Exported from skill_interview.exe on ${exportedAt.toISOString().slice(0, 10)} — ` +
      `${kept} ${kept === 1 ? 'item' : 'items'} across ` +
      `${bySkill.size} ${bySkill.size === 1 ? 'skill' : 'skills'}.`,
  ];

  for (const { skill, entries: group } of bySkill.values()) {
    lines.push('', `## ${skill.name}`);
    for (const entry of group) {
      lines.push(...(entry.kind === 'card' ? renderCard(entry) : renderQuestion(entry)));
    }
  }

  if (orphans.length > 0) {
    lines.push('', '## No longer tracked');
    for (const orphan of orphans) lines.push(...renderOrphan(orphan));
  }

  return `${lines.join('\n').trim()}\n`;
}

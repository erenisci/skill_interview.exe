/**
 * Normalizes a user-entered skill name into the duplicate-detection key.
 * `NGINX`, ` nginx `, and `Nginx` must all resolve to the same slug (FR-02).
 */
export function toSlug(name: string): string {
  return name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '') // strip combining marks left by NFKD
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export const MAX_SKILL_NAME_LENGTH = 80;

/** Skill names are untrusted input: they become search queries and prompt parameters. */
export function normalizeSkillName(raw: string): string {
  return raw.replace(/\s+/g, ' ').trim().slice(0, MAX_SKILL_NAME_LENGTH);
}

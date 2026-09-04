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

/**
 * Whether the user pasted a list instead of typing one skill.
 *
 * The form adds one skill per submit, so "nginx, Traefik" would become a single skill by
 * that name: searched for as one string, slugged to `nginx-traefik`, and grounded in
 * whatever that query happens to return. Catching it costs one check and saves a nonsense
 * row plus a wasted research job.
 *
 * Comma and semicolon only. A slash is legitimate — CI/CD and TCP/IP are real names.
 */
export function looksLikeAList(name: string): boolean {
  return /[,;]/.test(name);
}

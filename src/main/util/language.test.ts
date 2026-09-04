import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { looksLike, sourceMentionsSkill } from './language';

/** The frozen eval sources double as fixtures — the same text the harness scores against. */
function source(file: string): string {
  return readFileSync(join(process.cwd(), 'evals', 'sources', file), 'utf8');
}

describe('sourceMentionsSkill — the last line of defence for grounding', () => {
  it('accepts a real article about the skill', () => {
    expect(sourceMentionsSkill(source('nginx.txt'), 'nginx')).toBe(true);
    expect(sourceMentionsSkill(source('redis.txt'), 'Redis')).toBe(true);
  });

  it('rejects a sign-in page that never names the technology', () => {
    // TD-17: measured, the model wrote a fluent card about Redis from exactly this page.
    expect(sourceMentionsSkill(source('empty-login-wall.txt'), 'Redis')).toBe(false);
  });

  it('rejects a consent dialog', () => {
    expect(sourceMentionsSkill(source('empty-cookie-only.txt'), 'PostgreSQL')).toBe(false);
  });

  it('accepts a shortened form of the name', () => {
    // Rejecting this would trade a real source for a hypothetical one.
    expect(sourceMentionsSkill('Postgres is a relational database.', 'PostgreSQL')).toBe(true);
    expect(sourceMentionsSkill('PostgreSQL is a relational database.', 'Postgres')).toBe(true);
  });

  it('accepts a multi-word skill when the source names any part of it', () => {
    expect(sourceMentionsSkill('Kubernetes schedules containers.', 'Kubernetes Operators')).toBe(
      true,
    );
  });

  it('ignores casing and punctuation around the name', () => {
    expect(sourceMentionsSkill('The NGINX. server is fast.', 'nginx')).toBe(true);
  });

  it('rejects empty or unusable input rather than passing it through', () => {
    expect(sourceMentionsSkill('', 'nginx')).toBe(false);
    expect(sourceMentionsSkill('some text about other things', '')).toBe(false);
  });

  it('does not match a short skill name inside an unrelated longer word', () => {
    // A two-letter name must not be satisfied by any word that happens to start with it.
    expect(sourceMentionsSkill('Goldsmiths and gothic architecture.', 'Go')).toBe(false);
  });
});

describe('looksLike', () => {
  const english =
    'nginx is a reverse proxy that routes requests to the backend servers, and it handles ' +
    'many connections with a small memory footprint.';
  const turkish =
    'nginx bir ters vekil sunucudur ve gelen istekleri arka uçtaki sunuculara yönlendirir, ' +
    'bu işlemi düşük bellek kullanımı ile yapar.';

  it('recognises English prose', () => {
    expect(looksLike(english, 'en')).toBe(true);
    expect(looksLike(english, 'tr')).toBe(false);
  });

  it('recognises Turkish prose', () => {
    expect(looksLike(turkish, 'tr')).toBe(true);
    expect(looksLike(turkish, 'en')).toBe(false);
  });

  it('catches the failure that matters: Turkish asked for, English delivered', () => {
    // TD-18, measured at 33% language accuracy before this was enforced anywhere.
    expect(looksLike(english, 'tr')).toBe(false);
  });
});

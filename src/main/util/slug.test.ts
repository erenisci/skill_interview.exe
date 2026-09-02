import { describe, expect, it } from 'vitest';
import { MAX_SKILL_NAME_LENGTH, normalizeSkillName, toSlug } from './slug';

describe('toSlug', () => {
  it('collapses case and spacing variants onto one key (FR-02)', () => {
    const slugs = new Set(['NGINX', ' nginx ', 'Nginx', 'nginx'].map(toSlug));
    expect(slugs).toEqual(new Set(['nginx']));
  });

  it('replaces punctuation and spaces with single hyphens', () => {
    expect(toSlug('Node.js')).toBe('node-js');
    expect(toSlug('C++')).toBe('c');
    expect(toSlug('Amazon  Web   Services')).toBe('amazon-web-services');
  });

  it('does not leave leading or trailing hyphens', () => {
    expect(toSlug('  .NET  ')).toBe('net');
    expect(toSlug('---k8s---')).toBe('k8s');
  });

  it('returns an empty slug for input with no usable characters', () => {
    expect(toSlug('???')).toBe('');
    expect(toSlug('   ')).toBe('');
  });

  it('keeps distinct skills distinct', () => {
    expect(toSlug('nginx')).not.toBe(toSlug('Traefik'));
  });
});

describe('normalizeSkillName', () => {
  it('trims and collapses internal whitespace', () => {
    expect(normalizeSkillName('  Amazon   Web  Services ')).toBe('Amazon Web Services');
  });

  it('caps length, since the name becomes a search query and a prompt parameter', () => {
    expect(normalizeSkillName('x'.repeat(500))).toHaveLength(MAX_SKILL_NAME_LENGTH);
  });
});

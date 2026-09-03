import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { resolveDataDir } from './data-dir';

const DEFAULT_PATH = '/fake/userData';

describe('resolveDataDir — the default a real user always gets', () => {
  it('uses the caller-supplied default when nothing is set', () => {
    expect(resolveDataDir(DEFAULT_PATH, {})).toEqual({ path: DEFAULT_PATH, source: 'default' });
  });

  it('treats an empty string the same as unset', () => {
    // An env var set to '' by a launcher script is not an override; falling through to
    // the default is safer than opening a database at the current working directory.
    expect(resolveDataDir(DEFAULT_PATH, { SKILL_INTERVIEW_DATA_DIR: '' })).toEqual({
      path: DEFAULT_PATH,
      source: 'default',
    });
  });

  it('treats whitespace the same as unset', () => {
    expect(resolveDataDir(DEFAULT_PATH, { SKILL_INTERVIEW_DATA_DIR: '   ' })).toEqual({
      path: DEFAULT_PATH,
      source: 'default',
    });
  });
});

describe('resolveDataDir — the development override', () => {
  it('resolves a relative override against the current working directory', () => {
    const result = resolveDataDir(DEFAULT_PATH, { SKILL_INTERVIEW_DATA_DIR: './.dev-data' });
    expect(result).toEqual({ path: resolve('./.dev-data'), source: 'override' });
  });

  it('leaves an absolute override as given', () => {
    const absolute = resolve('/tmp/skill-interview-data');
    const result = resolveDataDir(DEFAULT_PATH, { SKILL_INTERVIEW_DATA_DIR: absolute });
    expect(result).toEqual({ path: absolute, source: 'override' });
  });

  it('does not touch the caller-supplied default when overridden', () => {
    const result = resolveDataDir(DEFAULT_PATH, { SKILL_INTERVIEW_DATA_DIR: './x' });
    expect(result.path).not.toBe(DEFAULT_PATH);
  });
});

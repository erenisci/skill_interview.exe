import { resolve } from 'node:path';

/**
 * Where the database lives, and how that was decided.
 *
 * `SKILL_INTERVIEW_DATA_DIR` overrides the caller-supplied default for development and
 * testing only — a real user never sets it (docs/operations/env-vars.md).
 *
 * Takes the default path as a parameter rather than reading `app.getPath('userData')`
 * itself, so this stays a pure function with no Electron dependency and is testable like
 * any other util ([slug.ts](./slug.ts)).
 */
export interface DataDir {
  readonly path: string;
  readonly source: 'override' | 'default';
}

export function resolveDataDir(
  defaultPath: string,
  env: Readonly<Record<string, string | undefined>> = process.env,
): DataDir {
  const override = env['SKILL_INTERVIEW_DATA_DIR'];
  if (!override || override.trim().length === 0) {
    return { path: defaultPath, source: 'default' };
  }
  return { path: resolve(override), source: 'override' };
}

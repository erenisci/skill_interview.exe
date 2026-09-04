import initial from './001-initial.sql?raw';
import jobRetryAt from './002-job-retry-at.sql?raw';
import claimsFeedback from './003-claims-feedback.sql?raw';
import pairwiseClaims from './004-pairwise-claims.sql?raw';
import dailySet from './005-daily-set.sql?raw';
import perSkillLimits from './006-per-skill-limits.sql?raw';
import classifyJob from './007-classify-job.sql?raw';

export interface Migration {
  readonly version: number;
  readonly name: string;
  readonly sql: string;
}

/**
 * Ordered, forward-only. Never edit an entry after release — a database in the wild
 * has already run it. To change the schema, append a new migration.
 */
export const MIGRATIONS: readonly Migration[] = [
  { version: 1, name: 'initial', sql: initial },
  { version: 2, name: 'job-retry-at', sql: jobRetryAt },
  { version: 3, name: 'claims-feedback', sql: claimsFeedback },
  { version: 4, name: 'pairwise-claims', sql: pairwiseClaims },
  { version: 5, name: 'daily-set', sql: dailySet },
  { version: 6, name: 'per-skill-limits', sql: perSkillLimits },
  { version: 7, name: 'classify-job', sql: classifyJob },
];

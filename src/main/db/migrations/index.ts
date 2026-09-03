import initial from './001-initial.sql?raw';
import jobRetryAt from './002-job-retry-at.sql?raw';
import claimsFeedback from './003-claims-feedback.sql?raw';

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
];

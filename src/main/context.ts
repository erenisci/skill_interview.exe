import { join } from 'node:path';
import { openDatabase, type Db } from './db';
import { JobsRepository } from './db/repositories/jobs';
import { SettingsRepository } from './db/repositories/settings';
import { SkillsRepository } from './db/repositories/skills';
import { OllamaLlmAdapter } from './llm/ollama';
import { StubLlmAdapter } from './llm/stub';
import type { LlmAdapter } from './llm/adapter';
import { log } from './util/logger';

export interface AppContext {
  readonly db: Db;
  readonly skills: SkillsRepository;
  readonly settings: SettingsRepository;
  readonly jobs: JobsRepository;
  /** Swapped, never branched on: nothing outside this file knows which one is live. */
  readonly llm: LlmAdapter;
}

export const DATABASE_FILENAME = 'skills.db';

export function createContext(userDataDir: string): AppContext {
  const file = join(userDataDir, DATABASE_FILENAME);
  const db = openDatabase(file);

  const settings = new SettingsRepository(db);
  const jobs = new JobsRepository(db);

  const reset = jobs.resetStale(new Date().toISOString());
  if (reset > 0)
    log.warn('queue', 'reset jobs left running by an abrupt shutdown', { count: reset });

  return {
    db,
    settings,
    jobs,
    skills: new SkillsRepository(db),
    llm: createLlmAdapter(settings),
  };
}

/**
 * No model selected means no runtime to talk to, so the stub stands in and the app
 * still boots — the user lands on the setup screen rather than a broken window.
 */
function createLlmAdapter(settings: SettingsRepository): LlmAdapter {
  const model = settings.get('ollama_model');
  const url = settings.get('ollama_url');
  if (!model || !url) {
    log.info('llm', 'no model selected; using the stub adapter');
    return new StubLlmAdapter();
  }
  return new OllamaLlmAdapter({ url, model });
}

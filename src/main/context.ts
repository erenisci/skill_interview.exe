import type { JobKind } from '@shared/domain';
import { join } from 'node:path';
import { openDatabase, type Db } from './db';
import { CardsRepository } from './db/repositories/cards';
import { JobsRepository } from './db/repositories/jobs';
import { RelationsRepository } from './db/repositories/relations';
import { SettingsRepository } from './db/repositories/settings';
import { SkillsRepository } from './db/repositories/skills';
import type { LlmAdapter } from './llm/adapter';
import { OllamaLlmAdapter } from './llm/ollama';
import { StubLlmAdapter } from './llm/stub';
import { createCompareHandler } from './pipeline/compare';
import { createResearchFailureHandler, createResearchHandler } from './pipeline/research';
import { JobQueue, type JobHandler } from './queue/queue';
import {
  CompositeSearchAdapter,
  GithubSearchAdapter,
  WikipediaSearchAdapter,
  type SearchAdapter,
} from './search';
import { log } from './util/logger';

export interface AppContext {
  readonly db: Db;
  readonly skills: SkillsRepository;
  readonly cards: CardsRepository;
  readonly relations: RelationsRepository;
  readonly settings: SettingsRepository;
  readonly jobs: JobsRepository;
  /** Swapped, never branched on: nothing outside this file knows which one is live. */
  readonly llm: LlmAdapter;
  readonly search: SearchAdapter;
  readonly queue: JobQueue;
}

export const DATABASE_FILENAME = 'skills.db';

export function createContext(userDataDir: string): AppContext {
  const file = join(userDataDir, DATABASE_FILENAME);
  const db = openDatabase(file);

  const settings = new SettingsRepository(db);
  const jobs = new JobsRepository(db);
  const skills = new SkillsRepository(db);
  const cards = new CardsRepository(db);
  const relations = new RelationsRepository(db);

  const reset = jobs.resetStale(new Date().toISOString());
  if (reset > 0)
    log.warn('queue', 'reset jobs left running by an abrupt shutdown', { count: reset });

  const llm = createLlmAdapter(settings);
  const search = createSearchAdapter(settings);

  const handlers = new Map<JobKind, JobHandler>([
    ['research', createResearchHandler({ skills, cards, relations, jobs, search, llm })],
    ['compare', createCompareHandler({ skills, cards, llm })],
  ]);

  const queue = new JobQueue({
    jobs,
    llm,
    handlers,
    onJobFailed: (job) => {
      if (job.kind === 'research') createResearchFailureHandler(skills)(job);
    },
  });

  return { db, settings, jobs, skills, cards, relations, llm, search, queue };
}

/**
 * No model selected means no runtime to talk to, so the stub stands in and the app still
 * boots — the user lands on the setup screen rather than a broken window.
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

function createSearchAdapter(settings: SettingsRepository): SearchAdapter {
  const token = settings.get('github_token');
  return new CompositeSearchAdapter([
    new GithubSearchAdapter(token ? { token } : {}),
    new WikipediaSearchAdapter(),
  ]);
}

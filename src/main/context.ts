import type { JobKind } from '@shared/domain';
import { join } from 'node:path';
import { openDatabase, type Db } from './db';
import { CardsRepository } from './db/repositories/cards';
import { FavoritesRepository } from './db/repositories/favorites';
import { JobsRepository } from './db/repositories/jobs';
import { QuestionsRepository } from './db/repositories/questions';
import { ReviewsRepository } from './db/repositories/reviews';
import { RelationsRepository } from './db/repositories/relations';
import { SettingsRepository } from './db/repositories/settings';
import { SkillsRepository } from './db/repositories/skills';
import type { LlmAdapter } from './llm/adapter';
import { OllamaLlmAdapter } from './llm/ollama';
import { StubLlmAdapter } from './llm/stub';
import { SwappableLlmAdapter } from './llm/swappable';
import { createCompareHandler } from './pipeline/compare';
import { createQuestionsHandler } from './pipeline/questions';
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
  readonly questions: QuestionsRepository;
  readonly reviews: ReviewsRepository;
  readonly favorites: FavoritesRepository;
  readonly relations: RelationsRepository;
  readonly settings: SettingsRepository;
  readonly jobs: JobsRepository;
  /**
   * A stable wrapper, never rebuilt: everything downstream captures this object once and
   * keeps it for the process lifetime. `applyLlmSettings` is the only thing allowed to
   * call `.replace()` on it — after `ollama_model` or `ollama_url` changes, so the app
   * picks up a newly selected model without a restart.
   */
  readonly llm: SwappableLlmAdapter;
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
  const questions = new QuestionsRepository(db);
  const reviews = new ReviewsRepository(db);
  const favorites = new FavoritesRepository(db);
  const relations = new RelationsRepository(db);

  const reset = jobs.resetStale(new Date().toISOString());
  if (reset > 0)
    log.warn('queue', 'reset jobs left running by an abrupt shutdown', { count: reset });

  const llm = new SwappableLlmAdapter(buildLlmAdapter(settings));
  const search = createSearchAdapter(settings);

  const handlers = new Map<JobKind, JobHandler>([
    ['research', createResearchHandler({ skills, cards, relations, jobs, search, llm })],
    ['compare', createCompareHandler({ skills, cards, llm })],
    [
      'generate-questions',
      createQuestionsHandler({ skills, cards, questions, relations, jobs, llm }),
    ],
  ]);

  const queue = new JobQueue({
    jobs,
    llm,
    handlers,
    onJobFailed: (job) => {
      if (job.kind === 'research') createResearchFailureHandler(skills)(job);
    },
  });

  return {
    db,
    settings,
    jobs,
    skills,
    cards,
    questions,
    reviews,
    favorites,
    relations,
    llm,
    search,
    queue,
  };
}

/**
 * No model selected means no runtime to talk to, so the stub stands in and the app still
 * boots — the user lands on the setup screen rather than a broken window.
 */
function buildLlmAdapter(settings: SettingsRepository): LlmAdapter {
  const model = settings.get('ollama_model');
  const url = settings.get('ollama_url');
  if (!model || !url) {
    log.info('llm', 'no model selected; using the stub adapter');
    return new StubLlmAdapter();
  }
  return new OllamaLlmAdapter({ url, model });
}

/**
 * Rebuilds the live adapter from current settings and swaps it in — the only way
 * `ollama_model` or `ollama_url` take effect without restarting the app. The outgoing
 * adapter is released first, inside `SwappableLlmAdapter.replace`, so a resident model
 * is never orphaned mid-swap.
 */
export async function applyLlmSettings(ctx: Pick<AppContext, 'llm' | 'settings'>): Promise<void> {
  await ctx.llm.replace(buildLlmAdapter(ctx.settings));
}

function createSearchAdapter(settings: SettingsRepository): SearchAdapter {
  const token = settings.get('github_token');
  return new CompositeSearchAdapter([
    new GithubSearchAdapter(token ? { token } : {}),
    new WikipediaSearchAdapter(),
  ]);
}

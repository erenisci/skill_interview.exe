import { appError, err, ok, type Result } from '@shared/result';
import { log } from '../util/logger';
import type { Candidate, ProviderId, SearchAdapter } from './adapter';

export type { Candidate, ProviderId, SearchAdapter } from './adapter';
export { htmlToText, isUsable, markdownToText, truncate } from './extract';
export { GithubSearchAdapter } from './github';
export { WikipediaSearchAdapter } from './wikipedia';

/**
 * Runs every provider and merges what comes back.
 *
 * **Provider failure degrades; it does not fail the job.** If GitHub is rate-limited,
 * Wikipedia alone can still produce a card. Only an empty merged result is an error —
 * and even that is not yet a decision to write nothing, because resolution has still to
 * reject candidates afterwards (docs/llm/rag-sources.md).
 */
export class CompositeSearchAdapter implements SearchAdapter {
  readonly id = 'composite';
  private readonly byProvider = new Map<ProviderId, SearchAdapter>();

  constructor(private readonly providers: readonly SearchAdapter[]) {}

  async findCandidates(skill: string, signal?: AbortSignal): Promise<Result<readonly Candidate[]>> {
    const results = await Promise.all(
      this.providers.map(async (provider) => ({
        provider,
        result: await provider.findCandidates(skill, signal),
      })),
    );

    const candidates: Candidate[] = [];
    const failures: string[] = [];

    for (const { provider, result } of results) {
      if (!result.ok) {
        failures.push(`${provider.id}: ${result.error.code}`);
        log.warn('search', 'provider failed, degrading', {
          provider: provider.id,
          code: result.error.code,
        });
        continue;
      }
      for (const candidate of result.value) {
        this.byProvider.set(candidate.provider, provider);
        candidates.push(candidate);
      }
    }

    if (candidates.length === 0) {
      const detail = failures.length > 0 ? failures.join('; ') : 'every provider returned nothing';
      return err(appError('provider', 'no-candidates', detail));
    }
    return ok(candidates);
  }

  async fetchText(candidate: Candidate, signal?: AbortSignal): Promise<Result<string>> {
    const owner = this.byProvider.get(candidate.provider);
    if (!owner) {
      return err(
        appError(
          'internal',
          'unrouted-candidate',
          `no provider owns a "${candidate.provider}" candidate`,
        ),
      );
    }
    return owner.fetchText(candidate, signal);
  }
}

import type { Result } from '@shared/result';

export type ProviderId = 'github' | 'docs' | 'wikipedia';

/**
 * A search hit that has **not** yet earned the right to ground anything.
 *
 * [ADR-0003](../../../docs/architecture/adr/0003-source-resolution.md): searching
 * "Zustand" returns the Wikipedia article on Pompeii, and "Redis" on GitHub returns an
 * interview guide. Both look like perfectly good results until something checks the
 * subject, so the type is deliberately not called `Source`.
 */
export interface Candidate {
  readonly provider: ProviderId;
  /** What the name gate matches against: a repository name or an article title. */
  readonly identity: string;
  readonly title: string;
  readonly url: string;
  /** A lead paragraph or description — enough for the subject check, not the full text. */
  readonly lead: string;
  readonly publisher: string;
  /** Needed for attribution: Wikipedia text is CC BY-SA. */
  readonly license: string | null;
  /** Where the full text lives, when it is not the candidate's own URL. */
  readonly contentUrl?: string;
}

/**
 * Finding candidates and fetching their text are separate calls on purpose. Resolution
 * sits between them, so the text of a candidate that fails the gates is never downloaded.
 */
export interface SearchAdapter {
  readonly id: string;
  findCandidates(skill: string, signal?: AbortSignal): Promise<Result<readonly Candidate[]>>;
  fetchText(candidate: Candidate, signal?: AbortSignal): Promise<Result<string>>;
}

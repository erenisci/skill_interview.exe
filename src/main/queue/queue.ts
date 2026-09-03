import type { Job, JobKind } from '@shared/domain';
import { appError, type AppError, type Result } from '@shared/result';
import type { JobsRepository } from '../db/repositories/jobs';
import type { LlmAdapter } from '../llm/adapter';
import { log } from '../util/logger';

/**
 * A unit of background work. Handlers return a Result rather than throwing, so a failure
 * carries the information the queue needs to decide between retrying and giving up.
 */
export type JobHandler = (job: Job) => Promise<Result<void>>;

export interface QueueDeps {
  readonly jobs: JobsRepository;
  /** Only `release` is used: the queue's job is to free the model, not to call it. */
  readonly llm: Pick<LlmAdapter, 'release'>;
  readonly handlers: ReadonlyMap<JobKind, JobHandler>;
  /**
   * Called when a job gives up for good. A handler cannot do this itself — it does not
   * know whether the queue will retry — and the domain state it owns (a skill stuck in
   * `researching`) would otherwise never be corrected.
   */
  readonly onJobFailed?: (job: Job, error: AppError) => void;
}

export interface QueueOptions {
  readonly maxAttempts?: number;
  readonly backoffMs?: (attempt: number) => number;
  readonly pollIntervalMs?: number;
  /** Injected so tests can drive time instead of waiting for it. */
  readonly now?: () => Date;
}

const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_POLL_INTERVAL_MS = 1_000;

/** 1s, 5s, 25s — long enough for a rate limit to clear, short enough to finish a session. */
const defaultBackoff = (attempt: number): number => 1_000 * 5 ** Math.max(0, attempt - 1);

export type StepResult = 'worked' | 'idle';

/**
 * The durable job loop.
 *
 * Two properties matter more than throughput here:
 *
 * 1. **Nothing is held in memory.** A claimed job is a row marked `running`; a crash
 *    leaves it recoverable rather than lost, and startup resets whatever was interrupted.
 *
 * 2. **The model is released when the queue drains** — once per drain, not on every idle
 *    tick. This is the memory design from ADR-0001, and it is the queue that implements it.
 *
 * Work is serial on purpose: the model is both the bottleneck and the memory cost, so
 * parallelism would double the footprint for no user-visible gain.
 */
export class JobQueue {
  private readonly maxAttempts: number;
  private readonly backoffMs: (attempt: number) => number;
  private readonly pollIntervalMs: number;
  private readonly now: () => Date;

  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;
  /** Whether anything has been processed since the model was last released. */
  private modelInUse = false;

  constructor(
    private readonly deps: QueueDeps,
    options: QueueOptions = {},
  ) {
    this.maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
    this.backoffMs = options.backoffMs ?? defaultBackoff;
    this.pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
    this.now = options.now ?? (() => new Date());
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      // Skip the tick rather than overlapping: a long job must not be run twice.
      if (this.running) return;
      void this.runOnce();
    }, this.pollIntervalMs);
    log.info('queue', 'started', { pollIntervalMs: this.pollIntervalMs });
  }

  async stop(): Promise<void> {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    await this.releaseIfIdle();
    log.info('queue', 'stopped');
  }

  /**
   * Processes at most one job. Returns whether there was anything to do, which is what
   * makes the loop testable without waiting on timers.
   */
  async runOnce(): Promise<StepResult> {
    if (this.running) return 'idle';
    this.running = true;
    try {
      const job = this.deps.jobs.claimNext(this.iso());
      if (!job) {
        await this.releaseIfIdle();
        return 'idle';
      }

      this.modelInUse = true;
      await this.process(job);
      return 'worked';
    } finally {
      this.running = false;
    }
  }

  private async process(job: Job): Promise<void> {
    const handler = this.deps.handlers.get(job.kind);
    if (!handler) {
      // Not retryable: a missing handler is a wiring mistake, and waiting will not fix it.
      this.fail(job, appError('internal', 'no-handler', `no handler registered for "${job.kind}"`));
      return;
    }

    let result: Result<void>;
    try {
      result = await handler(job);
    } catch (cause) {
      const detail = cause instanceof Error ? cause.message : String(cause);
      this.fail(job, appError('internal', 'handler-threw', detail));
      return;
    }

    if (result.ok) {
      this.deps.jobs.finish(job.id, 'done', this.iso());
      log.info('queue', 'job done', { jobId: job.id, kind: job.kind, attempts: job.attempts });
      return;
    }

    const error = result.error;
    if (!error.retryable) {
      this.fail(job, error);
      return;
    }
    if (job.attempts >= this.maxAttempts) {
      this.fail(job, error, 'attempts exhausted');
      return;
    }

    const delay = this.backoffMs(job.attempts);
    const retryAt = new Date(this.now().getTime() + delay).toISOString();
    this.deps.jobs.retryLater(job.id, retryAt, this.iso(), error.message);
    log.warn('queue', 'job retrying', {
      jobId: job.id,
      kind: job.kind,
      attempt: job.attempts,
      code: error.code,
      delayMs: delay,
    });
  }

  private fail(job: Job, error: AppError, note?: string): void {
    const message = note ? `${error.message} (${note})` : error.message;
    this.deps.jobs.finish(job.id, 'failed', this.iso(), message);
    try {
      this.deps.onJobFailed?.(job, error);
    } catch (cause) {
      // A broken cleanup hook must not stop the queue reporting the original failure.
      const detail = cause instanceof Error ? cause.message : String(cause);
      log.error('queue', 'failure hook threw', { jobId: job.id, detail });
    }
    // The identifier and the reason, never the payload — a job payload names a skill.
    log.error('queue', 'job failed', {
      jobId: job.id,
      kind: job.kind,
      attempts: job.attempts,
      kindOfError: error.kind,
      code: error.code,
    });
  }

  /** Frees the model, but only if something was actually generated since the last release. */
  private async releaseIfIdle(): Promise<void> {
    if (!this.modelInUse) return;
    this.modelInUse = false;
    await this.deps.llm.release();
  }

  private iso(): string {
    return this.now().toISOString();
  }
}

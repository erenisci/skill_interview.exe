import type { Job, JobKind } from '@shared/domain';
import { appError, err, ok, type Result } from '@shared/result';
import type { Database as Db } from 'better-sqlite3';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { migrate } from '../db/migrate';
import { JobsRepository } from '../db/repositories/jobs';
import { StubLlmAdapter } from '../llm/stub';
import { JobQueue, type JobHandler } from './queue';

let db: Db;
let jobs: JobsRepository;
let llm: StubLlmAdapter;
let clock: Date;

const START = new Date('2026-09-03T10:00:00.000Z');
const now = () => clock;
const advance = (ms: number) => {
  clock = new Date(clock.getTime() + ms);
};

beforeEach(() => {
  db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  migrate(db);
  jobs = new JobsRepository(db);
  llm = new StubLlmAdapter();
  clock = START;
});

afterEach(() => db.close());

function queue(handlers: Record<string, JobHandler>, maxAttempts = 3): JobQueue {
  return new JobQueue(
    { jobs, llm, handlers: new Map(Object.entries(handlers) as [JobKind, JobHandler][]) },
    { maxAttempts, now, backoffMs: () => 1_000 },
  );
}

const succeeds: JobHandler = async () => ok(undefined);
const transientlyFails: JobHandler = async () =>
  err(appError('transient', 'timeout', 'provider timed out'));
const configFails: JobHandler = async () =>
  err(appError('configuration', 'unreachable', 'Ollama is not running'));

describe('JobQueue.runOnce', () => {
  it('reports idle when there is nothing to do', async () => {
    expect(await queue({ research: succeeds }).runOnce()).toBe('idle');
  });

  it('runs a job and marks it done', async () => {
    const job = jobs.enqueue('research', { skillId: 1 }, START.toISOString());
    expect(await queue({ research: succeeds }).runOnce()).toBe('worked');
    expect(jobs.findById(job.id)?.status).toBe('done');
  });

  it('passes the job to its handler', async () => {
    const seen: Job[] = [];
    jobs.enqueue('research', { skillId: 7 }, START.toISOString());
    await queue({
      research: async (job) => {
        seen.push(job);
        return ok(undefined);
      },
    }).runOnce();
    expect(seen).toHaveLength(1);
    expect(JSON.parse(seen[0]?.payload ?? '{}')).toEqual({ skillId: 7 });
  });

  it('takes jobs oldest first', async () => {
    jobs.enqueue('research', { n: 1 }, '2026-09-03T09:00:00.000Z');
    jobs.enqueue('research', { n: 2 }, '2026-09-03T09:30:00.000Z');
    const order: number[] = [];
    const q = queue({
      research: async (job) => {
        order.push(JSON.parse(job.payload).n);
        return ok(undefined);
      },
    });
    await q.runOnce();
    await q.runOnce();
    expect(order).toEqual([1, 2]);
  });
});

describe('retrying', () => {
  it('returns a retryable failure to the queue with a backoff, not a terminal failure', async () => {
    const job = jobs.enqueue('research', {}, START.toISOString());
    await queue({ research: transientlyFails }).runOnce();

    const after = jobs.findById(job.id);
    expect(after?.status).toBe('pending');
    expect(after?.attempts).toBe(1);
    expect(after?.error).toContain('timed out');
    expect(after?.retryAt).toBe(new Date(START.getTime() + 1_000).toISOString());
  });

  it('does not claim a job that is still waiting out its backoff', async () => {
    jobs.enqueue('research', {}, START.toISOString());
    const q = queue({ research: transientlyFails });

    await q.runOnce();
    expect(await q.runOnce()).toBe('idle'); // still backing off

    advance(1_000);
    expect(await q.runOnce()).toBe('worked');
  });

  it('gives up after the attempt limit and records why', async () => {
    const job = jobs.enqueue('research', {}, START.toISOString());
    const q = queue({ research: transientlyFails }, 2);

    await q.runOnce();
    advance(1_000);
    await q.runOnce();

    const after = jobs.findById(job.id);
    expect(after?.status).toBe('failed');
    expect(after?.attempts).toBe(2);
    expect(after?.error).toContain('attempts exhausted');
  });

  it('never retries a configuration failure — waiting will not start Ollama', async () => {
    const job = jobs.enqueue('research', {}, START.toISOString());
    await queue({ research: configFails }).runOnce();

    const after = jobs.findById(job.id);
    expect(after?.status).toBe('failed');
    expect(after?.attempts).toBe(1);
  });

  it('fails a job whose handler throws rather than swallowing it', async () => {
    const job = jobs.enqueue('research', {}, START.toISOString());
    await queue({
      research: async () => {
        throw new Error('null is not an object');
      },
    }).runOnce();

    const after = jobs.findById(job.id);
    expect(after?.status).toBe('failed');
    expect(after?.error).toContain('null is not an object');
  });

  it('fails a job with no registered handler instead of leaving it pending forever', async () => {
    const job = jobs.enqueue('compare', {}, START.toISOString());
    await queue({ research: succeeds }).runOnce();

    const after = jobs.findById(job.id);
    expect(after?.status).toBe('failed');
    expect(after?.error).toContain('no handler');
  });
});

describe('model lifecycle', () => {
  it('releases the model when the queue drains', async () => {
    jobs.enqueue('research', {}, START.toISOString());
    const q = queue({ research: succeeds });

    await q.runOnce();
    expect(llm.releaseCount).toBe(0); // still working

    await q.runOnce();
    expect(llm.releaseCount).toBe(1); // drained
  });

  it('releases once per drain, not on every idle tick', async () => {
    jobs.enqueue('research', {}, START.toISOString());
    const q = queue({ research: succeeds });

    await q.runOnce();
    await q.runOnce();
    await q.runOnce();
    await q.runOnce();
    expect(llm.releaseCount).toBe(1);
  });

  it('releases again after new work arrives and drains', async () => {
    const q = queue({ research: succeeds });
    jobs.enqueue('research', {}, START.toISOString());
    await q.runOnce();
    await q.runOnce();

    jobs.enqueue('research', {}, START.toISOString());
    await q.runOnce();
    await q.runOnce();
    expect(llm.releaseCount).toBe(2);
  });

  it('does not release when it never had work', async () => {
    await queue({ research: succeeds }).runOnce();
    expect(llm.releaseCount).toBe(0);
  });

  it('releases on stop so a closing app does not leave the model resident', async () => {
    jobs.enqueue('research', {}, START.toISOString());
    const q = queue({ research: succeeds });
    await q.runOnce();
    await q.stop();
    expect(llm.releaseCount).toBe(1);
  });
});

describe('crash recovery', () => {
  it('resumes a job left running by an abrupt shutdown', async () => {
    const job = jobs.enqueue('research', {}, START.toISOString());
    jobs.claimNext(START.toISOString()); // claimed, then the process dies
    expect(jobs.findById(job.id)?.status).toBe('running');

    expect(jobs.resetStale(START.toISOString())).toBe(1);
    expect(jobs.findById(job.id)?.status).toBe('pending');

    await queue({ research: succeeds }).runOnce();
    expect(jobs.findById(job.id)?.status).toBe('done');
  });

  it('keeps the attempt count across a crash, so a job cannot retry forever', async () => {
    const job = jobs.enqueue('research', {}, START.toISOString());
    jobs.claimNext(START.toISOString());
    jobs.resetStale(START.toISOString());
    expect(jobs.findById(job.id)?.attempts).toBe(1);
  });

  it('preserves a backoff across a restart — restarting must not bypass a rate limit', async () => {
    const job = jobs.enqueue('research', {}, START.toISOString());
    await queue({ research: transientlyFails }).runOnce();
    const backoffUntil = jobs.findById(job.id)?.retryAt;
    expect(backoffUntil).not.toBeNull();

    // resetStale only touches jobs interrupted mid-run; one waiting out a backoff is
    // already in a consistent state and keeps its schedule.
    expect(jobs.resetStale(START.toISOString())).toBe(0);
    expect(jobs.findById(job.id)?.retryAt).toBe(backoffUntil);
    expect(await queue({ research: succeeds }).runOnce()).toBe('idle');

    advance(1_000);
    expect(await queue({ research: succeeds }).runOnce()).toBe('worked');
  });

  it('clears the backoff column on a job it does reset, so recovery is immediate', async () => {
    const job = jobs.enqueue('research', {}, START.toISOString());
    await queue({ research: transientlyFails }).runOnce();
    advance(1_000);
    jobs.claimNext(clock.toISOString()); // claimed again, then the process dies

    expect(jobs.resetStale(clock.toISOString())).toBe(1);
    const after = jobs.findById(job.id);
    expect(after?.status).toBe('pending');
    expect(after?.retryAt).toBeNull();
  });
});

describe('claiming', () => {
  it('marks a job running so a second caller cannot take it', () => {
    jobs.enqueue('research', {}, START.toISOString());
    expect(jobs.claimNext(START.toISOString())).not.toBeNull();
    expect(jobs.claimNext(START.toISOString())).toBeNull();
  });

  it('does not run overlapping steps', async () => {
    jobs.enqueue('research', {}, START.toISOString());
    jobs.enqueue('research', {}, START.toISOString());
    let inFlight = 0;
    let maxInFlight = 0;
    const q = queue({
      research: async () => {
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await Promise.resolve();
        inFlight -= 1;
        return ok(undefined) as Result<void>;
      },
    });
    await Promise.all([q.runOnce(), q.runOnce()]);
    expect(maxInFlight).toBe(1);
  });
});

describe('JobsRepository.lastFailureFor', () => {
  it('returns the reason the skill\u2019s work gave up', () => {
    const job = jobs.enqueue('research', { skillId: 7 }, START.toISOString());
    jobs.finish(job.id, 'failed', START.toISOString(), 'nothing resolved');

    expect(jobs.lastFailureFor(7)).toBe('nothing resolved');
  });

  it('does not confuse skill 1 with skill 12', () => {
    // The payload is matched with LIKE, so the pattern has to be bounded on both sides.
    // Without the closing brace, skill 1 would inherit every failure of 10 through 19.
    const job = jobs.enqueue('research', { skillId: 12 }, START.toISOString());
    jobs.finish(job.id, 'failed', START.toISOString(), 'twelve failed');

    expect(jobs.lastFailureFor(12)).toBe('twelve failed');
    expect(jobs.lastFailureFor(1)).toBeNull();
  });

  it('returns the most recent failure when a skill has failed more than once', () => {
    const first = jobs.enqueue('research', { skillId: 3 }, START.toISOString());
    jobs.finish(first.id, 'failed', START.toISOString(), 'the old reason');
    const second = jobs.enqueue('research', { skillId: 3 }, START.toISOString());
    jobs.finish(second.id, 'failed', START.toISOString(), 'the current reason');

    expect(jobs.lastFailureFor(3)).toBe('the current reason');
  });

  it('is null for a skill that has not failed', () => {
    jobs.enqueue('research', { skillId: 4 }, START.toISOString());
    expect(jobs.lastFailureFor(4)).toBeNull();
  });
});

describe('JobsRepository.enqueueUnique', () => {
  it('declines to hold two of the same pending job', () => {
    const first = jobs.enqueueUnique('generate-questions', { skillId: 3 }, START.toISOString());
    const second = jobs.enqueueUnique('generate-questions', { skillId: 3 }, START.toISOString());

    expect(first).not.toBeNull();
    expect(second).toBeNull();
    expect(jobs.countByStatus('pending')).toBe(1);
  });

  it('keeps jobs for different skills apart', () => {
    jobs.enqueueUnique('generate-questions', { skillId: 3 }, START.toISOString());
    jobs.enqueueUnique('generate-questions', { skillId: 4 }, START.toISOString());
    expect(jobs.countByStatus('pending')).toBe(2);
  });

  it('keeps jobs of different kinds apart', () => {
    jobs.enqueueUnique('generate-questions', { skillId: 3 }, START.toISOString());
    jobs.enqueueUnique('research', { skillId: 3 }, START.toISOString());
    expect(jobs.countByStatus('pending')).toBe(2);
  });

  it('enqueues again once the previous one is no longer pending', () => {
    // Work already finished may legitimately need doing again with what arrived since.
    const first = jobs.enqueueUnique('generate-questions', { skillId: 3 }, START.toISOString());
    jobs.finish(first?.id ?? 0, 'done', START.toISOString());

    expect(
      jobs.enqueueUnique('generate-questions', { skillId: 3 }, START.toISOString()),
    ).not.toBeNull();
  });

  it('caps a caller that would otherwise queue without bound', () => {
    // The shape of the bug this backstops: 1,098 rows on a real database, of which 514
    // were pending copies of the same handful of jobs.
    for (let i = 0; i < 50; i += 1) {
      jobs.enqueueUnique('generate-questions', { skillId: 9 }, START.toISOString());
    }
    expect(jobs.countByStatus('pending')).toBe(1);
  });
});

describe('JobsRepository.deleteForSkill', () => {
  it('takes every job belonging to the skill, whatever its state', () => {
    const pending = jobs.enqueue('research', { skillId: 5 }, START.toISOString());
    const failed = jobs.enqueue('generate-questions', { skillId: 5 }, START.toISOString());
    jobs.finish(failed.id, 'failed', START.toISOString(), 'nothing resolved');
    const done = jobs.enqueue('classify', { skillId: 5 }, START.toISOString());
    jobs.finish(done.id, 'done', START.toISOString());

    expect(jobs.deleteForSkill(5)).toBe(3);
    expect(jobs.findById(pending.id)).toBeNull();
    expect(jobs.findById(failed.id)).toBeNull();
    expect(jobs.findById(done.id)).toBeNull();
  });

  it('leaves other skills alone, including the ones whose ids share a prefix', () => {
    // Bounded on both sides, or skill 1 takes 10 through 19 with it.
    jobs.enqueue('research', { skillId: 1 }, START.toISOString());
    const twelve = jobs.enqueue('research', { skillId: 12 }, START.toISOString());

    expect(jobs.deleteForSkill(1)).toBe(1);
    expect(jobs.findById(twelve.id)).not.toBeNull();
  });

  it('is a no-op for a skill with no jobs', () => {
    expect(jobs.deleteForSkill(99)).toBe(0);
  });
});

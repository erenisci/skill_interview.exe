import { appError, err, ok, type Result } from '@shared/result';
import type { GenerationOutput, GenerationRequest, LlmAdapter } from './adapter';

/**
 * A model-free adapter.
 *
 * Two uses: automated tests, which never call a real runtime (docs/quality/testing-strategy.md),
 * and development on a machine with no model pulled — the rest of the app is buildable
 * without one, because generation is split from consumption.
 *
 * Queued responses are still put through the real schema parse, so a stub cannot smuggle
 * in output the validator would have rejected.
 */
export class StubLlmAdapter implements LlmAdapter {
  readonly id = 'stub';

  private readonly queue: unknown[];
  private released = 0;

  constructor(responses: readonly unknown[] = []) {
    this.queue = [...responses];
  }

  get releaseCount(): number {
    return this.released;
  }

  async listModels(): Promise<Result<readonly string[]>> {
    return ok(['stub']);
  }

  async generate<T>(request: GenerationRequest<T>): Promise<Result<GenerationOutput<T>>> {
    if (this.queue.length === 0) {
      return err(
        appError(
          'configuration',
          'stub-exhausted',
          `no stub response queued for schema "${request.schema.name}"`,
        ),
      );
    }
    const parsed = request.schema.parse(this.queue.shift());
    if (!parsed.ok) return parsed;
    return ok({ value: parsed.value, model: 'stub' });
  }

  async release(): Promise<void> {
    this.released += 1;
  }
}

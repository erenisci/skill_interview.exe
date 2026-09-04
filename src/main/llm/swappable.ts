import type { Result } from '@shared/result';
import type { GenerationOutput, GenerationRequest, LlmAdapter } from './adapter';

/**
 * A stable identity wrapping whichever adapter is actually live.
 *
 * Everything downstream — the queue, every pipeline stage — receives this once, at
 * startup, and holds onto it for the process lifetime; none of it re-reads `AppContext.llm`
 * later. Without this indirection, changing which model is selected would need every
 * handler rebuilt, which means restarting the app.
 *
 * `replace()` releases the outgoing adapter first. Skipping that would leak a resident
 * model: nothing else holds a reference to the old adapter once this wrapper drops it, so
 * nothing else could ever call `release()` on it again.
 */
export class SwappableLlmAdapter implements LlmAdapter {
  private inner: LlmAdapter;

  constructor(initial: LlmAdapter) {
    this.inner = initial;
  }

  get id(): string {
    return this.inner.id;
  }

  async replace(next: LlmAdapter): Promise<void> {
    const previous = this.inner;
    this.inner = next;
    await previous.release();
  }

  listModels(): Promise<Result<readonly string[]>> {
    return this.inner.listModels();
  }

  generate<T>(request: GenerationRequest<T>): Promise<Result<GenerationOutput<T>>> {
    return this.inner.generate(request);
  }

  release(): Promise<void> {
    return this.inner.release();
  }
}

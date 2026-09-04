import { ok, type Result } from '@shared/result';
import { describe, expect, it } from 'vitest';
import type { GenerationOutput, LlmAdapter } from './adapter';
import { SwappableLlmAdapter } from './swappable';

function fakeAdapter(id: string): LlmAdapter & { released: boolean } {
  return {
    id,
    released: false,
    async listModels(): Promise<Result<readonly string[]>> {
      return ok([id]);
    },
    async generate<T>(): Promise<Result<GenerationOutput<T>>> {
      return ok({ value: { id } as T, model: id });
    },
    async release(): Promise<void> {
      this.released = true;
    },
  };
}

describe('SwappableLlmAdapter — the identity everything else holds onto', () => {
  it('delegates id and listModels to whichever adapter is currently inner', async () => {
    const stub = fakeAdapter('stub');
    const swappable = new SwappableLlmAdapter(stub);
    expect(swappable.id).toBe('stub');
    expect(await swappable.listModels()).toEqual(ok(['stub']));
  });

  it('starts delegating to the new adapter immediately after replace', async () => {
    const stub = fakeAdapter('stub');
    const ollama = fakeAdapter('ollama');
    const swappable = new SwappableLlmAdapter(stub);

    await swappable.replace(ollama);

    expect(swappable.id).toBe('ollama');
    expect(await swappable.listModels()).toEqual(ok(['ollama']));
  });

  it('releases the outgoing adapter so a resident model is never orphaned', async () => {
    const stub = fakeAdapter('stub');
    const ollama = fakeAdapter('ollama');
    const swappable = new SwappableLlmAdapter(stub);

    await swappable.replace(ollama);

    expect(stub.released).toBe(true);
    expect(ollama.released).toBe(false);
  });

  it('never calls release on the adapter that is now current', async () => {
    const stub = fakeAdapter('stub');
    const ollama = fakeAdapter('ollama');
    const swappable = new SwappableLlmAdapter(stub);
    await swappable.replace(ollama);

    await swappable.release();

    // release() on the wrapper reaches the current adapter, not a stale one.
    expect(ollama.released).toBe(true);
  });
});

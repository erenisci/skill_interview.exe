import { appError, err, ok, type Result } from '@shared/result';
import { describe, expect, it } from 'vitest';
import type { AppContext } from '../context';
import type { GenerationOutput, LlmAdapter } from '../llm/adapter';
import { checkLlmReadiness } from './readiness';

/**
 * The regression these tests exist for: readiness used to short-circuit whenever the live
 * adapter was the stub — which is exactly when no model has been selected yet. The setup
 * screen then had no list to offer, so the only state that could show a model picker was
 * one the user could never reach without already having picked a model.
 */

function adapter(id: string, models: Result<readonly string[]>): LlmAdapter {
  return {
    id,
    async listModels() {
      return models;
    },
    async generate<T>(): Promise<Result<GenerationOutput<T>>> {
      throw new Error('not used by readiness');
    },
    async release() {},
  };
}

function context(settings: Record<string, string | null>, llm: LlmAdapter): AppContext {
  return {
    settings: { get: (key: string) => settings[key] ?? null },
    llm,
  } as unknown as AppContext;
}

describe('checkLlmReadiness', () => {
  it('reports ready when the selected model is one Ollama has', async () => {
    const ctx = context(
      { ollama_url: 'http://localhost:11434', ollama_model: 'qwen3:4b' },
      adapter('ollama', ok(['qwen3:4b', 'llama3:8b'])),
    );

    expect(await checkLlmReadiness(ctx)).toEqual({
      state: 'ready',
      models: ['qwen3:4b', 'llama3:8b'],
      selected: 'qwen3:4b',
    });
  });

  it('asks Ollama directly when the live adapter is the stub, and returns its list', async () => {
    // The case the old code got wrong: the live adapter is the stub precisely when no
    // model has been selected, and the user needs the list to get out of that state.
    const ctx = context(
      { ollama_url: 'http://localhost:11434', ollama_model: null },
      adapter('stub', ok(['stub'])),
    );

    const result = await checkLlmReadiness(ctx, () => adapter('probe', ok(['qwen3:4b'])));

    // The stub's own answer ("stub") must not be what reaches the setup screen.
    expect(result).toEqual({ state: 'no-model', models: ['qwen3:4b'] });
  });

  it('reports unreachable when the stub path probes an Ollama that is not running', async () => {
    const ctx = context(
      { ollama_url: 'http://localhost:11434', ollama_model: null },
      adapter('stub', ok(['stub'])),
    );

    const result = await checkLlmReadiness(ctx, () =>
      adapter('probe', err(appError('transient', 'econnrefused', 'connection refused'))),
    );

    expect(result.state).toBe('unreachable');
  });

  it('reports no-model when the selected model is no longer installed', async () => {
    const ctx = context(
      { ollama_url: 'http://localhost:11434', ollama_model: 'gone:7b' },
      adapter('ollama', ok(['qwen3:4b'])),
    );

    expect(await checkLlmReadiness(ctx)).toEqual({ state: 'no-model', models: ['qwen3:4b'] });
  });

  it('reports unreachable, with the url it tried, when Ollama does not answer', async () => {
    const ctx = context(
      { ollama_url: 'http://localhost:11434', ollama_model: 'qwen3:4b' },
      adapter('ollama', err(appError('transient', 'econnrefused', 'connection refused'))),
    );

    expect(await checkLlmReadiness(ctx)).toEqual({
      state: 'unreachable',
      url: 'http://localhost:11434',
      detail: 'connection refused',
    });
  });

  it('describes Ollama and the selection, never which adapter happens to be wired up', async () => {
    const ctx = context(
      { ollama_url: 'http://localhost:11434', ollama_model: 'qwen3:4b' },
      adapter('stub', ok(['stub'])),
    );

    // Stub adapter, but Ollama has the selected model: that is `ready`. There is no
    // "running on the stub" state left for this to fall into.
    const result = await checkLlmReadiness(ctx, () => adapter('probe', ok(['qwen3:4b'])));
    expect(result.state).toBe('ready');
  });
});

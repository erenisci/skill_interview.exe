import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { OllamaLlmAdapter } from './ollama';
import { structured } from './schema';

const CARD = structured('test-card', z.object({ title: z.string(), body: z.string() }));

interface Call {
  url: string;
  body: Record<string, unknown> | null;
}

/** Records what the adapter sent and replies with a canned response. */
function stubFetch(reply: () => Response | Promise<Response>): Call[] {
  const calls: Call[] = [];
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    calls.push({
      url,
      body: typeof init?.body === 'string' ? JSON.parse(init.body) : null,
    });
    return reply();
  });
  return calls;
}

function chatReply(content: unknown, model = 'qwen3:4b'): Response {
  return new Response(JSON.stringify({ model, message: { content } }), { status: 200 });
}

const adapter = () => new OllamaLlmAdapter({ url: 'http://localhost:11434/', model: 'qwen3:4b' });

afterEach(() => vi.unstubAllGlobals());

describe('OllamaLlmAdapter.generate', () => {
  it('constrains decoding with the JSON schema and returns the parsed value', async () => {
    const calls = stubFetch(() => chatReply(JSON.stringify({ title: 'nginx', body: 'a proxy' })));

    const result = await adapter().generate({ system: 's', prompt: 'p', schema: CARD });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.value).toEqual({ title: 'nginx', body: 'a proxy' });
      expect(result.value.model).toBe('qwen3:4b');
    }
    expect(calls[0]?.url).toBe('http://localhost:11434/api/chat');
    expect(calls[0]?.body?.['format']).toEqual(CARD.jsonSchema);
    expect(calls[0]?.body?.['stream']).toBe(false);
  });

  it('sends a keep_alive window so consecutive jobs reuse the loaded model', async () => {
    const calls = stubFetch(() => chatReply(JSON.stringify({ title: 't', body: 'b' })));
    await adapter().generate({ system: 's', prompt: 'p', schema: CARD });
    expect(calls[0]?.body?.['keep_alive']).toBe('5m');
  });

  it('treats prose where JSON was expected as a validation failure, not a partial success', async () => {
    stubFetch(() => chatReply('Sure! Here is the card you asked for.'));
    const result = await adapter().generate({ system: 's', prompt: 'p', schema: CARD });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe('validation');
      expect(result.error.code).toBe('not-json');
      expect(result.error.retryable).toBe(true);
    }
  });

  it('rejects well-formed JSON that violates the schema', async () => {
    stubFetch(() => chatReply(JSON.stringify({ title: 'nginx' })));
    const result = await adapter().generate({ system: 's', prompt: 'p', schema: CARD });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('schema-mismatch');
  });

  it('reports a refused connection as configuration, not transient — the user must act', async () => {
    stubFetch(() => {
      throw new Error('connect ECONNREFUSED 127.0.0.1:11434');
    });
    const result = await adapter().generate({ system: 's', prompt: 'p', schema: CARD });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe('configuration');
      expect(result.error.retryable).toBe(false);
    }
  });

  it('reports a server error as transient', async () => {
    stubFetch(() => new Response('boom', { status: 500 }));
    const result = await adapter().generate({ system: 's', prompt: 'p', schema: CARD });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe('transient');
  });
});

describe('OllamaLlmAdapter.listModels', () => {
  it('returns installed model names', async () => {
    stubFetch(
      () =>
        new Response(JSON.stringify({ models: [{ name: 'qwen3:4b' }, { name: 'gemma3:4b' }] }), {
          status: 200,
        }),
    );
    const result = await adapter().listModels();
    expect(result.ok && result.value).toEqual(['qwen3:4b', 'gemma3:4b']);
  });

  it('ignores malformed entries rather than trusting the response shape', async () => {
    stubFetch(() => new Response(JSON.stringify({ models: [{ name: 42 }, {}] }), { status: 200 }));
    const result = await adapter().listModels();
    expect(result.ok && result.value).toEqual([]);
  });
});

describe('OllamaLlmAdapter.release', () => {
  it('evicts the model with keep_alive 0 — the memory budget depends on this', async () => {
    const calls = stubFetch(() => new Response('{}', { status: 200 }));
    await adapter().release();
    expect(calls[0]?.url).toBe('http://localhost:11434/api/generate');
    expect(calls[0]?.body?.['keep_alive']).toBe(0);
  });

  it('never throws when eviction fails — it is a hint, not an operation', async () => {
    stubFetch(() => {
      throw new Error('gone');
    });
    await expect(adapter().release()).resolves.toBeUndefined();
  });
});

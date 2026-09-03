import { appError, err, ok, type Result } from '@shared/result';
import { log } from '../util/logger';
import type { GenerationOutput, GenerationRequest, LlmAdapter } from './adapter';

/**
 * The only file that knows Ollama exists.
 *
 * Three behaviours here are load-bearing, not details:
 *
 * 1. `think: false` — qwen3 is a hybrid reasoning model and thinks by default. Measured
 *    on the reference machine, the same request took 1.6 s without thinking and 19.6 s
 *    with it, for identical output; a worse case reached 134 s. The reasoning trace never
 *    reaches the user, and none of this product's tasks — write from supplied text,
 *    classify, pick a candidate — benefit from it. This is the single largest latency
 *    factor in the pipeline, larger than partial GPU offload.
 *
 * 2. `keep_alive` — Ollama keeps a model resident for ~5 minutes after a request.
 *    Generation passes a short window so consecutive jobs reuse the loaded weights
 *    (a cold load costs ~5.7 s, a warm one nothing); `release()` passes 0 to evict it
 *    when the queue drains.
 *
 * 3. `format` — a JSON Schema is sent with every request, so the runtime constrains
 *    decoding to valid output. That makes schema conformance a runtime guarantee
 *    instead of something each model's prompt-following has to earn.
 */

const DEFAULT_TIMEOUT_MS = 300_000;

/**
 * Set explicitly rather than left to the runtime, because the context window is a VRAM
 * decision as much as a prompt one. The real budget lands with retrieval truncation in
 * M-2; until then this is Ollama's own default, stated rather than inherited.
 */
const DEFAULT_NUM_CTX = 4096;

/**
 * Force every layer onto the GPU.
 *
 * Ollama's automatic split is conservative: measured on the reference machine it put the
 * model at 27% CPU / 73% GPU while leaving 1.6 GB of the 4 GB card unused. Asking for
 * more layers than the model has pins all of them, which measured 100% GPU at 2.9 GB —
 * full context and full offload at once.
 *
 * The risk is a smaller GPU than the reference one, where forcing the split could fail
 * to allocate. It is therefore configurable, and a failure surfaces as a normal
 * configuration error rather than silently degrading.
 */
const DEFAULT_NUM_GPU = 99;

interface OllamaTagsResponse {
  models?: { name?: unknown }[];
}

interface OllamaChatResponse {
  model?: unknown;
  message?: { content?: unknown };
}

export interface OllamaConfig {
  readonly url: string;
  readonly model: string;
  /** How long Ollama keeps the model resident between requests within a job run. */
  readonly keepAlive?: string;
  readonly timeoutMs?: number;
  /** Context window. Bounded by VRAM, not only by prompt length. */
  readonly numCtx?: number;
  /** Layers to offload. Defaults to forcing all of them; lower it for a smaller GPU. */
  readonly numGpu?: number;
}

export class OllamaLlmAdapter implements LlmAdapter {
  readonly id = 'ollama';

  private readonly url: string;
  private readonly model: string;
  private readonly keepAlive: string;
  private readonly timeoutMs: number;
  private readonly numCtx: number;
  private readonly numGpu: number;

  constructor(config: OllamaConfig) {
    this.url = config.url.replace(/\/+$/, '');
    this.model = config.model;
    this.keepAlive = config.keepAlive ?? '5m';
    this.timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.numCtx = config.numCtx ?? DEFAULT_NUM_CTX;
    this.numGpu = config.numGpu ?? DEFAULT_NUM_GPU;
  }

  async listModels(): Promise<Result<readonly string[]>> {
    const response = await this.request('/api/tags', undefined, 10_000);
    if (!response.ok) return response;
    const body = response.value as OllamaTagsResponse;
    const names = (body.models ?? [])
      .map((m) => m.name)
      .filter((n): n is string => typeof n === 'string');
    return ok(names);
  }

  async generate<T>(request: GenerationRequest<T>): Promise<Result<GenerationOutput<T>>> {
    const started = Date.now();
    const response = await this.request(
      '/api/chat',
      {
        model: this.model,
        stream: false,
        think: false,
        keep_alive: this.keepAlive,
        format: request.schema.jsonSchema,
        options: { num_ctx: this.numCtx, num_gpu: this.numGpu },
        messages: [
          { role: 'system', content: request.system },
          { role: 'user', content: request.prompt },
        ],
      },
      this.timeoutMs,
      request.signal,
    );
    if (!response.ok) return response;

    const body = response.value as OllamaChatResponse;
    const content = body.message?.content;
    if (typeof content !== 'string') {
      return err(appError('validation', 'no-content', 'Ollama returned no message content'));
    }

    let raw: unknown;
    try {
      raw = JSON.parse(content);
    } catch {
      // Prose where JSON was expected is a parse failure, never a partial success.
      return err(appError('validation', 'not-json', 'model output did not parse as JSON'));
    }

    const parsed = request.schema.parse(raw);
    if (!parsed.ok) return parsed;

    const model = typeof body.model === 'string' ? body.model : this.model;
    log.debug('llm', 'generation complete', {
      schema: request.schema.name,
      model,
      ms: Date.now() - started,
    });
    return ok({ value: parsed.value, model });
  }

  /** Evicts the model from memory. Failure is logged, never thrown: it is a hint to Ollama. */
  async release(): Promise<void> {
    const result = await this.request(
      '/api/generate',
      { model: this.model, keep_alive: 0 },
      10_000,
    );
    if (result.ok) log.info('llm', 'model released', { model: this.model });
    else log.warn('llm', 'model release failed', { code: result.error.code });
  }

  private async request(
    path: string,
    body: unknown,
    timeoutMs: number,
    signal?: AbortSignal,
  ): Promise<Result<unknown>> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const onAbort = () => controller.abort();
    signal?.addEventListener('abort', onAbort);

    try {
      const response = await fetch(`${this.url}${path}`, {
        method: body === undefined ? 'GET' : 'POST',
        headers: body === undefined ? undefined : { 'content-type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
      });

      if (!response.ok) {
        const kind = response.status === 404 ? 'configuration' : 'transient';
        return err(
          appError(kind, `http-${response.status}`, `Ollama responded ${response.status}`),
        );
      }
      return ok((await response.json()) as unknown);
    } catch (cause) {
      if (controller.signal.aborted) {
        return err(
          appError('transient', 'timeout', `Ollama did not respond within ${timeoutMs}ms`),
        );
      }
      // Connection refused means the runtime is not running — the user must act, so this
      // is configuration, not transient. The two must never be conflated in the UI.
      const detail = cause instanceof Error ? cause.message : String(cause);
      return err(
        appError('configuration', 'unreachable', `cannot reach Ollama at ${this.url}: ${detail}`),
      );
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    }
  }
}

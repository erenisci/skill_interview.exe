import type { Result } from '@shared/result';

/**
 * A schema the adapter can both constrain generation with and validate against.
 *
 * Two layers on purpose: `jsonSchema` is handed to the runtime for grammar-constrained
 * decoding, and `parse` still narrows the result afterwards. The constraint is not
 * trusted on its own — model output is untrusted input even when the model is local
 * (docs/llm/guardrails.md).
 */
export interface StructuredSchema<T> {
  readonly name: string;
  readonly jsonSchema: Record<string, unknown>;
  readonly parse: (raw: unknown) => Result<T>;
}

export interface GenerationRequest<T> {
  readonly system: string;
  readonly prompt: string;
  readonly schema: StructuredSchema<T>;
  readonly signal?: AbortSignal;
}

export interface GenerationOutput<T> {
  readonly value: T;
  /** Stamped onto every generated row so a regression can be attributed. */
  readonly model: string;
}

/**
 * The only interface pipeline code may depend on. Nothing outside `src/main/llm/`
 * imports a concrete implementation — that is what makes ADR-0001's swappability real
 * rather than aspirational.
 */
export interface LlmAdapter {
  readonly id: string;
  listModels(): Promise<Result<readonly string[]>>;
  generate<T>(request: GenerationRequest<T>): Promise<Result<GenerationOutput<T>>>;
  /**
   * Frees the model from memory. Called when the job queue drains — this is the
   * mechanism behind the memory budget, not an optimization (docs/operations/performance.md).
   */
  release(): Promise<void>;
}

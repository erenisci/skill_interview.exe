/**
 * Result-shaped returns. Fallible operations return these instead of throwing across
 * stage or IPC boundaries — see docs/operations/error-handling.md.
 */

export type AppErrorKind =
  | 'transient' // network timeout, provider busy — retry
  | 'provider' // a provider returned nothing usable — degrade
  | 'validation' // malformed or schema-violating output — retry, then fail
  | 'configuration' // Ollama unreachable, model missing — not retried, user must act
  | 'data' // migration failure, corrupt database — fatal
  | 'internal'; // broken invariant — never swallowed

export interface AppError {
  readonly kind: AppErrorKind;
  readonly code: string;
  readonly message: string;
  readonly retryable: boolean;
}

export type Result<T, E = AppError> = { ok: true; value: T } | { ok: false; error: E };

export function ok<T>(value: T): Result<T, never> {
  return { ok: true, value };
}

export function err<E>(error: E): Result<never, E> {
  return { ok: false, error };
}

const RETRYABLE: ReadonlySet<AppErrorKind> = new Set<AppErrorKind>(['transient', 'validation']);

export function appError(kind: AppErrorKind, code: string, message: string): AppError {
  return { kind, code, message, retryable: RETRYABLE.has(kind) };
}

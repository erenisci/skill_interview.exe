import { appError, err, ok, type Result } from '@shared/result';

/**
 * One place that knows how an outbound request fails.
 *
 * The error kinds matter downstream: the queue retries `transient` and refuses to retry
 * `configuration`, so mapping a 429 and a 404 to the same thing would make the retry
 * policy meaningless (docs/operations/error-handling.md).
 */

export const USER_AGENT = 'skill_interview.exe (+https://github.com/erenisci/skill_interview.exe)';

const DEFAULT_TIMEOUT_MS = 20_000;

export interface HttpOptions {
  readonly headers?: Record<string, string>;
  readonly timeoutMs?: number;
  readonly signal?: AbortSignal;
}

export async function fetchText(url: string, options: HttpOptions = {}): Promise<Result<string>> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const onAbort = () => controller.abort();
  options.signal?.addEventListener('abort', onAbort);

  try {
    const response = await fetch(url, {
      headers: { 'user-agent': USER_AGENT, ...options.headers },
      signal: controller.signal,
      redirect: 'follow',
    });

    if (!response.ok) return err(httpError(response.status, url));
    return ok(await response.text());
  } catch (cause) {
    if (controller.signal.aborted) {
      return err(appError('transient', 'timeout', `${url} did not respond within ${timeoutMs}ms`));
    }
    const detail = cause instanceof Error ? cause.message : String(cause);
    return err(appError('transient', 'network', `${url} could not be reached: ${detail}`));
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener('abort', onAbort);
  }
}

export async function fetchJson(url: string, options: HttpOptions = {}): Promise<Result<unknown>> {
  const text = await fetchText(url, {
    ...options,
    headers: { accept: 'application/json', ...options.headers },
  });
  if (!text.ok) return text;
  try {
    return ok(JSON.parse(text.value) as unknown);
  } catch {
    return err(appError('provider', 'not-json', `${url} did not return JSON`));
  }
}

function httpError(status: number, url: string) {
  // 429 and 5xx clear on their own; 401/403/404 do not, so retrying them wastes attempts.
  if (status === 429 || status >= 500) {
    return appError('transient', `http-${status}`, `${url} responded ${status}`);
  }
  if (status === 404) return appError('provider', 'http-404', `${url} was not found`);
  return appError('provider', `http-${status}`, `${url} responded ${status}`);
}

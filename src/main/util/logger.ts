/**
 * Structured logging, one JSON object per line.
 *
 * See docs/operations/logging.md. The "what not to log" list matters more than the
 * "what to log" one: skill names, card text, answers, and keys never appear here.
 * Log identifiers and shapes — `skillId`, not the name.
 */

export type LogLevel = 'error' | 'warn' | 'info' | 'debug';
export type LogArea = 'app' | 'db' | 'ipc' | 'queue' | 'pipeline' | 'llm' | 'search' | 'scheduler';

const ORDER: Record<LogLevel, number> = { error: 0, warn: 1, info: 2, debug: 3 };

const threshold: LogLevel = process.env['NODE_ENV'] === 'development' ? 'debug' : 'info';

export type LogFields = Record<string, string | number | boolean | null>;

function emit(level: LogLevel, area: LogArea, message: string, fields?: LogFields): void {
  if (ORDER[level] > ORDER[threshold]) return;
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    level,
    area,
    message,
    ...fields,
  });
  if (level === 'error') console.error(line);
  else console.log(line);
}

export const log = {
  error: (area: LogArea, message: string, fields?: LogFields) =>
    emit('error', area, message, fields),
  warn: (area: LogArea, message: string, fields?: LogFields) => emit('warn', area, message, fields),
  info: (area: LogArea, message: string, fields?: LogFields) => emit('info', area, message, fields),
  debug: (area: LogArea, message: string, fields?: LogFields) =>
    emit('debug', area, message, fields),
};

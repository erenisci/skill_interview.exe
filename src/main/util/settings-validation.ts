import { appError, err, ok, type Result } from '@shared/result';

/**
 * Validates and normalises the settings the app actually depends on.
 *
 * Without this, the settings screen is a way to quietly break the scheduler: a
 * `reminder_time` of "half six" makes `isReminderDue` return false forever and the reminder
 * simply never fires again, with nothing on screen to say why. A daily count of "-1" or
 * "lots" falls back to a default the user did not choose and cannot see.
 *
 * Failing loudly at the boundary is the whole point — a rejected value keeps the old one,
 * and the user is told which field was wrong ([configuration.md](../../../docs/operations/configuration.md)).
 */

/** Days can be zero — a user who wants only questions sets cards to 0, deliberately. */
const MAX_DAILY_ITEMS = 50;

const TIME = /^([01]?\d|2[0-3]):([0-5]\d)$/;

function count(key: string, value: string): Result<string> {
  // `Number('')` is 0, so an empty field would silently mean "none today" rather than
  // being refused — a cleared input is a mistake, not a choice to review nothing.
  if (value.trim().length === 0) {
    return err(appError('validation', `bad-${key}`, `${key} cannot be empty`));
  }

  const parsed = Number(value.trim());
  if (!Number.isInteger(parsed) || parsed < 0) {
    return err(appError('validation', `bad-${key}`, `${key} must be a whole number, zero or more`));
  }
  if (parsed > MAX_DAILY_ITEMS) {
    return err(
      appError(
        'validation',
        `bad-${key}`,
        `${key} above ${String(MAX_DAILY_ITEMS)} is not a day's work`,
      ),
    );
  }
  return ok(String(parsed));
}

/**
 * Returns the value to store, or the reason it was refused. Unknown keys pass through:
 * this guards what the app reads, and is not a registry of everything it may ever store.
 */
export function validateSetting(key: string, rawValue: string): Result<string> {
  const value = rawValue.trim();

  switch (key) {
    case 'daily_cards':
    case 'daily_questions':
      return count(key, value);

    case 'reminder_time': {
      const match = TIME.exec(value);
      if (!match) {
        return err(appError('validation', 'bad-reminder_time', 'reminder time must be HH:MM'));
      }
      // Stored zero-padded so string comparison and display agree: "9:05" and "09:05" are
      // the same time and should not be two different stored values.
      return ok(`${match[1]?.padStart(2, '0') ?? '00'}:${match[2] ?? '00'}`);
    }

    case 'reminder_enabled':
    case 'close_to_tray':
    case 'launch_at_startup':
      if (value !== 'true' && value !== 'false') {
        return err(appError('validation', `bad-${key}`, `${key} must be true or false`));
      }
      return ok(value);

    case 'ollama_url': {
      // `canParse` rather than a try/catch: a malformed URL here is an expected user typo,
      // not an exceptional condition to catch and translate.
      if (!URL.canParse(value)) {
        return err(appError('validation', 'bad-ollama_url', 'Ollama URL is not a valid URL'));
      }
      const parsed = new URL(value);
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        return err(appError('validation', 'bad-ollama_url', 'Ollama URL must be http or https'));
      }
      // Trailing slashes are stripped by the adapter anyway; storing one form avoids two
      // settings that mean the same thing.
      return ok(value.replace(/\/+$/, ''));
    }

    default:
      return ok(value);
  }
}

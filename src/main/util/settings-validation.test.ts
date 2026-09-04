import { describe, expect, it } from 'vitest';
import { validateSetting } from './settings-validation';

function accepted(key: string, value: string): string {
  const result = validateSetting(key, value);
  if (!result.ok)
    throw new Error(`expected ${key}="${value}" to be accepted: ${result.error.message}`);
  return result.value;
}

function refused(key: string, value: string): string {
  const result = validateSetting(key, value);
  if (result.ok) throw new Error(`expected ${key}="${value}" to be refused, got "${result.value}"`);
  return result.error.code;
}

describe('daily counts', () => {
  it('accepts a whole number', () => {
    expect(accepted('daily_cards', '3')).toBe('3');
    expect(accepted('daily_questions', '10')).toBe('10');
  });

  it('accepts zero — wanting only questions is a real choice', () => {
    expect(accepted('daily_cards', '0')).toBe('0');
  });

  it('trims rather than refusing over whitespace', () => {
    expect(accepted('daily_cards', ' 4 ')).toBe('4');
  });

  it('refuses text, fractions and negatives', () => {
    expect(refused('daily_cards', 'lots')).toBe('bad-daily_cards');
    expect(refused('daily_cards', '2.5')).toBe('bad-daily_cards');
    expect(refused('daily_cards', '-1')).toBe('bad-daily_cards');
  });

  it('refuses a count no one could work through in a day', () => {
    expect(refused('daily_questions', '5000')).toBe('bad-daily_questions');
  });

  it('refuses an empty value instead of storing a silent default', () => {
    expect(refused('daily_cards', '')).toBe('bad-daily_cards');
  });
});

describe('reminder_time', () => {
  it('accepts a 24-hour time', () => {
    expect(accepted('reminder_time', '18:00')).toBe('18:00');
    expect(accepted('reminder_time', '23:59')).toBe('23:59');
    expect(accepted('reminder_time', '00:00')).toBe('00:00');
  });

  it('zero-pads, so one time is not stored two ways', () => {
    expect(accepted('reminder_time', '9:05')).toBe('09:05');
  });

  it('refuses anything the reminder could not read', () => {
    // The failure this exists to prevent: `isReminderDue` rejects a malformed time and the
    // reminder then never fires again, with nothing on screen to explain it.
    expect(refused('reminder_time', 'half six')).toBe('bad-reminder_time');
    expect(refused('reminder_time', '25:00')).toBe('bad-reminder_time');
    expect(refused('reminder_time', '18:70')).toBe('bad-reminder_time');
    expect(refused('reminder_time', '1800')).toBe('bad-reminder_time');
  });
});

describe('the boolean flags', () => {
  it('accepts the two values each allows', () => {
    expect(accepted('reminder_enabled', 'true')).toBe('true');
    expect(accepted('reminder_enabled', 'false')).toBe('false');
    expect(accepted('close_to_tray', 'true')).toBe('true');
    expect(accepted('close_to_tray', 'false')).toBe('false');
  });

  it('refuses anything else', () => {
    expect(refused('reminder_enabled', 'yes')).toBe('bad-reminder_enabled');
    // A flag that fails open would make the window unclosable, or the app unquittable.
    expect(refused('close_to_tray', 'on')).toBe('bad-close_to_tray');
    expect(refused('close_to_tray', '')).toBe('bad-close_to_tray');
  });
});

describe('ollama_url', () => {
  it('accepts an http or https URL', () => {
    expect(accepted('ollama_url', 'http://localhost:11434')).toBe('http://localhost:11434');
    expect(accepted('ollama_url', 'https://ollama.example.test')).toBe(
      'https://ollama.example.test',
    );
  });

  it('strips a trailing slash, so one host is not two settings', () => {
    expect(accepted('ollama_url', 'http://localhost:11434/')).toBe('http://localhost:11434');
  });

  it('refuses a malformed URL', () => {
    expect(refused('ollama_url', 'localhost:11434')).toBe('bad-ollama_url');
    expect(refused('ollama_url', 'not a url')).toBe('bad-ollama_url');
  });

  it('refuses a scheme the adapter cannot speak', () => {
    expect(refused('ollama_url', 'ftp://localhost')).toBe('bad-ollama_url');
    expect(refused('ollama_url', 'file:///etc/passwd')).toBe('bad-ollama_url');
  });
});

describe('unknown keys', () => {
  it('passes through, trimmed', () => {
    // This guards what the app reads; it is not a registry of everything it may store.
    expect(accepted('github_token', '  ghp_example  ')).toBe('ghp_example');
    expect(accepted('something_new', 'value')).toBe('value');
  });
});

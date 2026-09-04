import type { SystemStatus } from '@shared/domain';
import { CHANNELS } from '@shared/ipc';
import { useCallback, useEffect, useState } from 'react';

interface Props {
  readonly status: SystemStatus;
  /** Re-reads system status, so a changed model or URL shows its new state here. */
  readonly onChanged: () => Promise<void>;
}

/**
 * Everything the user is allowed to change, and nothing else.
 *
 * Values are written one field at a time, on blur or on toggle, rather than behind a Save
 * button. Each is validated in the main process and a refusal keeps the old value — so the
 * failure the user sees is "that time is not valid", not a reminder that silently stops
 * firing (`src/main/util/settings-validation.ts`).
 */

const KEYS = [
  'daily_cards',
  'daily_questions',
  'reminder_enabled',
  'reminder_time',
  'close_to_tray',
  'launch_at_startup',
  'ollama_url',
  'ollama_model',
  'github_token',
] as const;

type Key = (typeof KEYS)[number];
type Values = Partial<Record<Key, string>>;

export function SettingsView({ status, onChanged }: Props): React.JSX.Element {
  const [values, setValues] = useState<Values | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<Key | null>(null);

  const load = useCallback(async (cancelled?: () => boolean) => {
    const entries = await Promise.all(
      KEYS.map(async (key) => [key, await window.api.invoke(CHANNELS.settingsGet, key)] as const),
    );
    if (cancelled?.()) return;

    const next: Values = {};
    for (const [key, result] of entries) {
      if (result.ok) next[key] = result.value ?? '';
      else setError(result.error.message);
    }
    setValues(next);
  }, []);

  useEffect(() => {
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the main process is the external system this subscribes to; setState runs after the await, and the guard covers unmount
    void load(() => cancelled);
    return () => {
      cancelled = true;
    };
  }, [load]);

  async function save(key: Key, value: string): Promise<void> {
    setError(null);
    const result = await window.api.invoke(CHANNELS.settingsSet, { key, value });
    if (!result.ok) {
      setError(result.error.message);
      // Refused, so the stored value is unchanged — put the field back to it rather than
      // leaving an invalid value on screen looking accepted.
      await load();
      return;
    }
    setSaved(key);
    await load();
    if (key === 'ollama_model' || key === 'ollama_url') await onChanged();
  }

  if (!values) return <p className="muted">Loading settings…</p>;

  const models = status.llm.state === 'unreachable' ? [] : status.llm.models;

  function field(
    key: Key,
    label: string,
    hint: string,
    input: React.JSX.Element,
  ): React.JSX.Element {
    return (
      <div style={{ marginBottom: 18 }}>
        <label className="row" style={{ justifyContent: 'space-between', marginBottom: 4 }}>
          <span>{label}</span>
          {saved === key && (
            <span className="muted" style={{ fontSize: 12 }}>
              saved
            </span>
          )}
        </label>
        {input}
        <p className="muted" style={{ fontSize: 12, margin: '4px 0 0' }}>
          {hint}
        </p>
      </div>
    );
  }

  return (
    <div>
      <h1>Settings</h1>
      <p className="subtitle">Stored on this machine, in the same database as everything else.</p>

      {error && (
        <div className="panel">
          <p className="error" style={{ margin: 0 }}>
            {error}
          </p>
        </div>
      )}

      <div className="panel">
        <h3 style={{ marginTop: 0 }}>Daily set</h3>

        {field(
          'daily_cards',
          'Cards per day',
          'How many cards the daily set draws. Zero is allowed if you only want questions.',
          <input
            type="number"
            min={0}
            defaultValue={values.daily_cards ?? ''}
            onBlur={(e) => void save('daily_cards', e.target.value)}
            aria-label="Cards per day"
          />,
        )}

        {field(
          'daily_questions',
          'Questions per day',
          'Each skill produces at most five questions, so one researched skill can fill this on its own.',
          <input
            type="number"
            min={0}
            defaultValue={values.daily_questions ?? ''}
            onBlur={(e) => void save('daily_questions', e.target.value)}
            aria-label="Questions per day"
          />,
        )}

        {field(
          'reminder_enabled',
          'Remind me',
          'A notification, only if the day’s set is still unfinished.',
          <div className="row">
            <input
              type="checkbox"
              checked={values.reminder_enabled === 'true'}
              onChange={(e) => void save('reminder_enabled', String(e.target.checked))}
              aria-label="Remind me"
            />
            <input
              type="time"
              defaultValue={values.reminder_time ?? ''}
              disabled={values.reminder_enabled !== 'true'}
              onBlur={(e) => void save('reminder_time', e.target.value)}
              aria-label="Reminder time"
            />
          </div>,
        )}

        {field(
          'launch_at_startup',
          'Start with Windows',
          'Opens straight to the notification area, without a window. Takes effect in the installed app, not in a development build.',
          <input
            type="checkbox"
            checked={values.launch_at_startup === 'true'}
            onChange={(e) => void save('launch_at_startup', String(e.target.checked))}
            aria-label="Start with Windows"
          />,
        )}

        {field(
          'close_to_tray',
          'Keep running when the window is closed',
          // Stated plainly because the alternative is a user believing they quit the app
          // and then wondering why the reminder never arrives.
          'Closing the window hides it in the notification area instead of quitting. A reminder needs the app running to arrive; quit for real from the tray icon’s menu.',
          <input
            type="checkbox"
            checked={values.close_to_tray === 'true'}
            onChange={(e) => void save('close_to_tray', String(e.target.checked))}
            aria-label="Keep running when the window is closed"
          />,
        )}
      </div>

      <div className="panel">
        <h3 style={{ marginTop: 0 }}>Model</h3>

        {field(
          'ollama_model',
          'Ollama model',
          models.length === 0
            ? 'Ollama is not reachable, so there is nothing to choose from yet.'
            : 'Changing this takes effect immediately — the running model is released and the new one takes over.',
          <select
            value={values.ollama_model ?? ''}
            disabled={models.length === 0}
            onChange={(e) => void save('ollama_model', e.target.value)}
            aria-label="Ollama model"
          >
            <option value="">Not selected</option>
            {models.map((model) => (
              <option key={model} value={model}>
                {model}
              </option>
            ))}
          </select>,
        )}

        {field(
          'ollama_url',
          'Ollama URL',
          'Where Ollama is reached. Change this only if you moved it off the default port.',
          <input
            style={{ width: '100%' }}
            defaultValue={values.ollama_url ?? ''}
            onBlur={(e) => void save('ollama_url', e.target.value)}
            aria-label="Ollama URL"
          />,
        )}
      </div>

      <div className="panel">
        <h3 style={{ marginTop: 0 }}>Search</h3>

        {field(
          'github_token',
          'GitHub token (optional)',
          'Research works without one. A token only raises GitHub’s rate limit, and is stored locally, never logged and never exported.',
          <input
            type="password"
            style={{ width: '100%' }}
            defaultValue={values.github_token ?? ''}
            placeholder="Not set"
            onBlur={(e) => void save('github_token', e.target.value)}
            aria-label="GitHub token"
          />,
        )}
      </div>
    </div>
  );
}

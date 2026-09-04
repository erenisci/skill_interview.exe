import type { SystemStatus } from '@shared/domain';
import { CHANNELS } from '@shared/ipc';
import { useState } from 'react';

interface Props {
  readonly status: SystemStatus;
  /** Returns a promise so this view can show that a re-check is actually in flight. */
  readonly onRetry: () => Promise<void>;
  readonly onContinueAnyway: () => void;
}

/**
 * Both states here need a different explanation and a different next action. "Ollama is
 * missing" and "Ollama is running but no model is selected" look alike in code and are
 * entirely different problems for the user (docs/operations/error-handling.md).
 */
export function SetupView({ status, onRetry, onContinueAnyway }: Props): React.JSX.Element {
  const llm = status.llm;
  const [busy, setBusy] = useState<'checking' | string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function selectModel(model: string): Promise<void> {
    setBusy(model);
    setError(null);
    // The adapter reloads on the main side as soon as this lands — no restart needed
    // (src/main/context.ts, applyLlmSettings).
    const result = await window.api.invoke(CHANNELS.settingsSet, {
      key: 'ollama_model',
      value: model,
    });
    if (!result.ok) {
      setBusy(null);
      setError(result.error.message);
      return;
    }
    await onRetry();
    setBusy(null);
  }

  /**
   * Checking is a network round trip to Ollama, so it must look like one. Without this the
   * button appears dead on click — the state it produces is often identical to the state
   * it replaced, and nothing else on screen moves.
   */
  async function check(): Promise<void> {
    setBusy('checking');
    setError(null);
    await onRetry();
    setBusy(null);
  }

  return (
    <div className="app">
      <h1>Setup</h1>
      <p className="subtitle">
        Cards and questions are written by a model running on your machine. Nothing is sent
        anywhere.
      </p>

      <div className="panel">
        {llm.state === 'unreachable' && (
          <>
            <h2>Ollama is not reachable</h2>
            <p className="muted">
              Tried <code>{llm.url}</code> — {llm.detail}
            </p>
            <p>Install Ollama, then pull a model:</p>
            <pre className="commands">ollama pull qwen3:4b{'\n'}ollama serve</pre>
          </>
        )}

        {llm.state === 'no-model' && (
          <>
            <h2>Ollama is running, but no usable model is selected</h2>
            {llm.models.length === 0 ? (
              <>
                <p className="muted">No models are installed yet.</p>
                <pre className="commands">ollama pull qwen3:4b</pre>
              </>
            ) : (
              <>
                <p className="muted">Choose one:</p>
                <ul className="list">
                  {llm.models.map((m) => (
                    <li key={m} style={{ padding: 0 }}>
                      <button
                        style={{ width: '100%', textAlign: 'left' }}
                        disabled={busy !== null}
                        onClick={() => void selectModel(m)}
                      >
                        <code>{m}</code>
                        {busy === m && ' — selecting…'}
                      </button>
                    </li>
                  ))}
                </ul>
                {error && <p className="error">{error}</p>}
              </>
            )}
          </>
        )}

        <div className="row" style={{ marginTop: 18 }}>
          <button className="primary" disabled={busy !== null} onClick={() => void check()}>
            {busy === 'checking' ? 'Checking…' : 'Check again'}
          </button>
          <button disabled={busy !== null} onClick={onContinueAnyway}>
            Continue without a model
          </button>
        </div>
      </div>

      <p className="muted">
        v{status.appVersion} · schema {status.schemaVersion}
      </p>
    </div>
  );
}

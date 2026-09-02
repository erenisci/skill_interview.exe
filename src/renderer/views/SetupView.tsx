import type { SystemStatus } from '@shared/domain';

interface Props {
  readonly status: SystemStatus;
  readonly onRetry: () => void;
  readonly onContinueAnyway: () => void;
}

/**
 * The four states here need four different explanations. "Ollama is missing" and
 * "Ollama is running but has no model" look alike in code and are entirely different
 * problems for the user (docs/operations/error-handling.md).
 */
export function SetupView({ status, onRetry, onContinueAnyway }: Props): React.JSX.Element {
  const llm = status.llm;

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
                <p className="muted">Installed models:</p>
                <ul className="list">
                  {llm.models.map((m) => (
                    <li key={m}>
                      <code>{m}</code>
                    </li>
                  ))}
                </ul>
                <p className="muted">Model selection lands with the settings screen (M-8).</p>
              </>
            )}
          </>
        )}

        {llm.state === 'stub' && (
          <>
            <h2>Running without a model</h2>
            <p className="muted">
              No model is configured, so generation is stubbed. Everything that does not need the
              model — adding skills, storage, the job queue — works normally.
            </p>
          </>
        )}

        <div className="row" style={{ marginTop: 18 }}>
          <button className="primary" onClick={onRetry}>
            Check again
          </button>
          <button onClick={onContinueAnyway}>Continue without a model</button>
        </div>
      </div>

      <p className="muted">
        v{status.appVersion} · schema {status.schemaVersion}
      </p>
    </div>
  );
}

import { useCallback, useEffect, useState } from 'react';
import type { ContentLanguage, Skill, SystemStatus } from '@shared/domain';
import { CHANNELS } from '@shared/ipc';

interface Props {
  readonly status: SystemStatus;
  readonly onOpenSetup: () => void;
}

export function SkillsView({ status, onOpenSetup }: Props): React.JSX.Element {
  const [skills, setSkills] = useState<readonly Skill[]>([]);
  const [name, setName] = useState('');
  const [language, setLanguage] = useState<ContentLanguage>('en');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async (cancelled?: () => boolean) => {
    const result = await window.api.invoke(CHANNELS.skillsList, undefined);
    if (cancelled?.()) return;
    if (result.ok) setSkills(result.value);
    else setError(result.error.message);
  }, []);

  useEffect(() => {
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the main process is the external system this subscribes to; setState runs after the await, and the guard covers unmount
    void load(() => cancelled);
    return () => {
      cancelled = true;
    };
  }, [load]);

  async function add(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    if (name.trim().length === 0) return;
    setBusy(true);
    setError(null);
    const result = await window.api.invoke(CHANNELS.skillsAdd, { name, contentLang: language });
    setBusy(false);
    if (!result.ok) {
      setError(result.error.message);
      return;
    }
    setName('');
    await load();
  }

  async function remove(id: number): Promise<void> {
    const result = await window.api.invoke(CHANNELS.skillsRemove, id);
    if (!result.ok) setError(result.error.message);
    await load();
  }

  return (
    <div className="app">
      <h1>Skills</h1>
      <p className="subtitle">
        The technologies on your CV. Each one gets researched, then turned into cards and questions.
      </p>

      <div className="panel">
        <form className="row" onSubmit={(e) => void add(e)}>
          <input
            style={{ flex: 1 }}
            placeholder="nginx, Traefik, WSL…"
            value={name}
            onChange={(e) => setName(e.target.value)}
            aria-label="Skill name"
          />
          <select
            value={language}
            onChange={(e) => setLanguage(e.target.value as ContentLanguage)}
            aria-label="Content language"
          >
            <option value="en">English</option>
            <option value="tr">Türkçe</option>
          </select>
          <button className="primary" type="submit" disabled={busy || name.trim().length === 0}>
            Add
          </button>
        </form>
        {error && <p className="error">{error}</p>}
      </div>

      <div className="panel">
        {skills.length === 0 ? (
          <p className="empty">No skills yet. Add the first one above.</p>
        ) : (
          <ul className="list">
            {skills.map((skill) => (
              <li key={skill.id}>
                <span>
                  {skill.name}{' '}
                  <span className="muted" style={{ fontSize: 12 }}>
                    {skill.contentLang}
                  </span>
                </span>
                <span className="row">
                  <span className={`badge ${skill.status}`}>{skill.status}</span>
                  <button onClick={() => void remove(skill.id)}>Remove</button>
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <p className="muted">
        v{status.appVersion} · schema {status.schemaVersion} ·{' '}
        {status.llm.state === 'ready' ? (
          <>model {status.llm.selected}</>
        ) : (
          <>
            no model —{' '}
            <button
              onClick={onOpenSetup}
              style={{
                padding: '0 4px',
                border: 'none',
                background: 'none',
                color: 'inherit',
                textDecoration: 'underline',
              }}
            >
              setup
            </button>
          </>
        )}
      </p>
    </div>
  );
}

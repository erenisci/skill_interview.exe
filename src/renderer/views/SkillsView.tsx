import type { ContentLanguage, Skill, SystemStatus } from '@shared/domain';
import { CHANNELS, type CardWithSources, type RelatedSkill } from '@shared/ipc';
import { useCallback, useEffect, useState } from 'react';
import { QuestionList } from './QuestionList';

interface Props {
  readonly status: SystemStatus;
  readonly onOpenSetup: () => void;
}

/** Research runs in the background, so the list has to notice when it finishes. */
const POLL_INTERVAL_MS = 2_000;
const isWorking = (skills: readonly Skill[]): boolean =>
  skills.some((s) => s.status === 'pending' || s.status === 'researching');

export function SkillsView({ status, onOpenSetup }: Props): React.JSX.Element {
  const [skills, setSkills] = useState<readonly Skill[]>([]);
  const [name, setName] = useState('');
  const [language, setLanguage] = useState<ContentLanguage>('en');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [openId, setOpenId] = useState<number | null>(null);
  const [cards, setCards] = useState<readonly CardWithSources[]>([]);
  const [related, setRelated] = useState<readonly RelatedSkill[]>([]);

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

  // Poll only while something is still being researched, then stop.
  useEffect(() => {
    if (!isWorking(skills)) return;
    const timer = setInterval(() => void load(), POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [skills, load]);

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
    if (openId === id) setOpenId(null);
    await load();
  }

  async function toggle(skill: Skill): Promise<void> {
    if (openId === skill.id) {
      setOpenId(null);
      return;
    }
    setOpenId(skill.id);
    setCards([]);
    setRelated([]);
    const [cardResult, relatedResult] = await Promise.all([
      window.api.invoke(CHANNELS.cardsForSkill, skill.id),
      window.api.invoke(CHANNELS.skillsRelated, skill.id),
    ]);
    if (cardResult.ok) setCards(cardResult.value);
    else setError(cardResult.error.message);
    if (relatedResult.ok) setRelated(relatedResult.value);
  }

  return (
    <div>
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
              <li key={skill.id} style={{ flexDirection: 'column', alignItems: 'stretch' }}>
                <div className="row" style={{ justifyContent: 'space-between', width: '100%' }}>
                  <span>
                    {skill.name}{' '}
                    <span className="muted" style={{ fontSize: 12 }}>
                      {skill.contentLang}
                    </span>
                  </span>
                  <span className="row">
                    <span className={`badge ${skill.status}`}>{skill.status}</span>
                    {skill.status === 'ready' && (
                      <button onClick={() => void toggle(skill)}>
                        {openId === skill.id ? 'Hide' : 'Read'}
                      </button>
                    )}
                    <button onClick={() => void remove(skill.id)}>Remove</button>
                  </span>
                </div>

                {openId === skill.id && (
                  <div className="card">
                    {related.length > 0 && (
                      <p className="muted" style={{ fontSize: 12, marginTop: 0 }}>
                        Related —{' '}
                        {related.map((r, i) => (
                          <span key={r.skill.id}>
                            {i > 0 && ' · '}
                            {r.skill.name}
                            <span style={{ opacity: 0.6 }}> {r.strength.toFixed(2)}</span>
                          </span>
                        ))}
                      </p>
                    )}
                    {cards.length === 0 ? (
                      <p className="muted">Loading…</p>
                    ) : (
                      cards.map(({ card, sources }) => (
                        <article key={card.id}>
                          <h3>{card.title}</h3>
                          {/* Rendered as text: this derives from an arbitrary web page. */}
                          <p className="card-body">{card.bodyMd}</p>
                          <p className="muted" style={{ fontSize: 12 }}>
                            Sources —{' '}
                            {sources.map((source, i) => (
                              <span key={source.id}>
                                {i > 0 && ' · '}
                                <a href={source.url} target="_blank" rel="noreferrer">
                                  {source.title}
                                </a>
                                {source.license ? ` (${source.license})` : ''}
                              </span>
                            ))}
                          </p>
                          <p className="muted" style={{ fontSize: 12 }}>
                            {card.model} · {card.promptVersion}
                          </p>
                        </article>
                      ))
                    )}

                    <h3>Questions</h3>
                    <QuestionList skillId={skill.id} />
                  </div>
                )}
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

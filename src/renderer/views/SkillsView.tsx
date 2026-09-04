import type { Skill, SystemStatus } from '@shared/domain';
import { CHANNELS, type CardWithSources, type RelatedSkill } from '@shared/ipc';
import { useCallback, useEffect, useState } from 'react';
import { QuestionSupply } from './QuestionSupply';

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
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [openId, setOpenId] = useState<number | null>(null);
  const [cards, setCards] = useState<readonly CardWithSources[]>([]);
  const [related, setRelated] = useState<readonly RelatedSkill[]>([]);
  const [failures, setFailures] = useState<Readonly<Record<number, string>>>({});

  const load = useCallback(async (cancelled?: () => boolean) => {
    const result = await window.api.invoke(CHANNELS.skillsList, undefined);
    if (cancelled?.()) return;
    if (!result.ok) {
      setError(result.error.message);
      return;
    }
    setSkills(result.value);

    // A red badge and nothing else is indistinguishable from a broken app, and the reason
    // is usually the user's to act on — a name too generic to resolve, or Ollama gone.
    // Only failed skills are asked about, so this is empty in the ordinary case.
    const failed = result.value.filter((skill) => skill.status === 'failed');
    const reasons = await Promise.all(
      failed.map(
        async (skill) =>
          [skill.id, await window.api.invoke(CHANNELS.skillsFailure, skill.id)] as const,
      ),
    );
    if (cancelled?.()) return;
    const next: Record<number, string> = {};
    for (const [id, reason] of reasons) {
      if (reason.ok && reason.value !== null) next[id] = reason.value;
    }
    setFailures(next);
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
    const result = await window.api.invoke(CHANNELS.skillsAdd, { name, contentLang: 'en' });
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

  /**
   * A blank field means "no cap of its own"; 0 means "not today", which parks a skill
   * without deleting it and losing its review history.
   */
  async function saveLimit(skill: Skill, field: 'cards' | 'questions', raw: string): Promise<void> {
    const trimmed = raw.trim();
    const value = trimmed.length === 0 ? null : Number(trimmed);
    if (value !== null && (!Number.isInteger(value) || value < 0)) {
      setError('A per-skill limit must be a whole number, or blank for no limit.');
      return;
    }
    setError(null);
    const result = await window.api.invoke(CHANNELS.skillsLimits, {
      skillId: skill.id,
      cards: field === 'cards' ? value : skill.dailyCards,
      questions: field === 'questions' ? value : skill.dailyQuestions,
    });
    if (!result.ok) setError(result.error.message);
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
    // Primers only. A comparison card belongs to a pair rather than to a skill, and it is
    // daily content — it is met in Today, alongside the questions drawn from it.
    if (cardResult.ok) setCards(cardResult.value.filter(({ card }) => card.type === 'primer'));
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
            // Singular on purpose: the form adds one skill per submit, and a comma-separated
            // placeholder invites a list that would be stored as a single nonsense skill.
            placeholder="e.g. Kubernetes"
            value={name}
            onChange={(e) => setName(e.target.value)}
            aria-label="Skill name"
          />
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
                <div className="skill-row">
                  {/* `title` so a name the column had to truncate is still readable. */}
                  <span className="skill-name" title={skill.name}>
                    {skill.name}
                  </span>

                  {/* In the row rather than inside the card: this is a property of the skill,
                      not of the card, and burying it behind Read meant nobody found it. */}
                  <span className="limits-cell">
                    {skill.status === 'ready' && (
                      <span
                        className="limits"
                        title="Blank means no limit. 0 pauses the skill without deleting it."
                      >
                        <span className="limits-label">per day</span>
                        <label>
                          <input
                            type="number"
                            min={0}
                            placeholder="∞"
                            defaultValue={skill.dailyCards ?? ''}
                            onBlur={(e) => void saveLimit(skill, 'cards', e.target.value)}
                            aria-label={`Cards per day from ${skill.name}`}
                          />
                          cards
                        </label>
                        {/* Reads as one sentence — "1 cards & 5 questions" — rather than as two
                          controls that happen to sit next to each other. */}
                        <span aria-hidden="true" className="limits-join">
                          &amp;
                        </span>
                        <label>
                          <input
                            type="number"
                            min={0}
                            placeholder="∞"
                            defaultValue={skill.dailyQuestions ?? ''}
                            onBlur={(e) => void saveLimit(skill, 'questions', e.target.value)}
                            aria-label={`Questions per day from ${skill.name}`}
                          />
                          questions
                        </label>
                      </span>
                    )}
                  </span>

                  <span className="skill-actions">
                    <span className={`badge ${skill.status}`}>{skill.status}</span>
                    {skill.status === 'ready' && (
                      <button className="toggle" onClick={() => void toggle(skill)}>
                        {openId === skill.id ? 'Hide' : 'Read'}
                      </button>
                    )}
                    <button onClick={() => void remove(skill.id)}>Remove</button>
                  </span>
                </div>

                {skill.status === 'failed' && failures[skill.id] && (
                  <p
                    className="error"
                    style={{ fontSize: 12, margin: '6px 0 0', whiteSpace: 'pre-wrap' }}
                  >
                    {failures[skill.id]}
                  </p>
                )}

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

                    <QuestionSupply skillId={skill.id} />
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

import type { AnswerRating } from '@shared/domain';
import { CHANNELS, type DailySet, type DailySetEntry } from '@shared/ipc';
import { useCallback, useEffect, useState } from 'react';

/**
 * The daily set — FR-40 through FR-44. A card carries no correctness, so its two buttons
 * ask the only thing there is to ask: did this need real review, or was it already known.
 * A question's rating is derived instead: the option picked was correct, or it was not —
 * there is no third state to offer (ADR-0007).
 */

function ratingForQuestion(pickedCorrect: boolean): AnswerRating {
  return pickedCorrect ? 'good' : 'again';
}

export function DailyView(): React.JSX.Element {
  const [set, setSet] = useState<DailySet | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [answered, setAnswered] = useState<Readonly<Record<number, number>>>({});
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async (cancelled?: () => boolean) => {
    const result = await window.api.invoke(CHANNELS.dailyGet, undefined);
    if (cancelled?.()) return;
    if (result.ok) setSet(result.value);
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

  async function answer(entry: DailySetEntry, rating: AnswerRating): Promise<void> {
    const itemId = entry.kind === 'card' ? entry.card.card.id : entry.question.id;
    const key = `${entry.kind}:${itemId}`;
    setBusy(key);
    const result = await window.api.invoke(CHANNELS.dailyAnswer, {
      itemType: entry.kind,
      itemId,
      rating,
    });
    setBusy(null);
    if (!result.ok) {
      setError(result.error.message);
      return;
    }
    await load();
  }

  if (!set && !error) return <p className="muted">Loading today's set…</p>;

  if (error) {
    return (
      <div className="panel">
        <p className="error">{error}</p>
      </div>
    );
  }

  if (!set || set.items.length === 0) {
    return (
      <div className="panel empty">
        <p>Nothing due today, and nothing new to add.</p>
        <p className="muted" style={{ fontSize: 13 }}>
          Add more skills, or check back once the ones you have finish researching.
        </p>
      </div>
    );
  }

  const remaining = set.items.filter((item) => !item.completed).length;

  return (
    <div>
      <p className="muted" style={{ marginTop: 0 }}>
        {remaining === 0
          ? "Today's set is done."
          : `${remaining} of ${set.items.length} left for today.`}
      </p>

      {set.items.map((item) => {
        const itemId = item.kind === 'card' ? item.card.card.id : item.question.id;
        const key = `${item.kind}:${itemId}`;

        if (item.kind === 'card') {
          return (
            <article key={key} className="panel">
              <h3 style={{ marginTop: 0 }}>{item.card.card.title}</h3>
              <p className="card-body">{item.card.card.bodyMd}</p>
              <p className="muted" style={{ fontSize: 12 }}>
                Sources —{' '}
                {item.card.sources.map((source, i) => (
                  <span key={source.id}>
                    {i > 0 && ' · '}
                    <a href={source.url} target="_blank" rel="noreferrer">
                      {source.title}
                    </a>
                  </span>
                ))}
              </p>
              {item.completed ? (
                <span className="badge ready">done</span>
              ) : (
                <div className="row">
                  <button disabled={busy === key} onClick={() => void answer(item, 'again')}>
                    Needed review
                  </button>
                  <button
                    className="primary"
                    disabled={busy === key}
                    onClick={() => void answer(item, 'good')}
                  >
                    Knew it
                  </button>
                </div>
              )}
            </article>
          );
        }

        const question = item.question;
        const chosen = answered[question.id];
        const revealed = chosen !== undefined || item.completed;

        return (
          <article key={key} className="panel">
            <p style={{ fontWeight: 600, marginTop: 0, marginBottom: 12 }}>{question.stem}</p>
            <ul className="list" style={{ gap: 4 }}>
              {question.options.map((option) => {
                const picked = chosen === option.id;
                const mark = !revealed ? '' : option.isCorrect ? ' ✓' : picked ? ' ✗' : '';
                return (
                  <li key={option.id} style={{ padding: 0 }}>
                    <button
                      style={{
                        width: '100%',
                        textAlign: 'left',
                        opacity: revealed && !option.isCorrect && !picked ? 0.6 : 1,
                      }}
                      disabled={revealed || busy === key}
                      onClick={() => {
                        setAnswered({ ...answered, [question.id]: option.id });
                        void answer(item, ratingForQuestion(option.isCorrect));
                      }}
                    >
                      {option.text}
                      {mark}
                    </button>
                  </li>
                );
              })}
            </ul>
            {revealed && (
              <p className="card-body" style={{ marginTop: 12, marginBottom: 0 }}>
                {question.explanation}
              </p>
            )}
          </article>
        );
      })}
    </div>
  );
}

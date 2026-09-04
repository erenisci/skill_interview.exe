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
  /** Keys are `kind:id`, so a card and a question with the same id cannot collide. */
  const [kept, setKept] = useState<ReadonlySet<string>>(new Set());

  const load = useCallback(async (cancelled?: () => boolean) => {
    const [today, favorites] = await Promise.all([
      window.api.invoke(CHANNELS.dailyGet, undefined),
      window.api.invoke(CHANNELS.favoritesList, undefined),
    ]);
    if (cancelled?.()) return;
    if (today.ok) setSet(today.value);
    else setError(today.error.message);
    if (favorites.ok) {
      setKept(
        new Set(favorites.value.map((f) => `${f.favorite.itemType}:${String(f.favorite.itemId)}`)),
      );
    }
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

  async function toggleKept(entry: DailySetEntry): Promise<void> {
    const itemId = entry.kind === 'card' ? entry.card.card.id : entry.question.id;
    const result = await window.api.invoke(CHANNELS.favoritesToggle, {
      itemType: entry.kind,
      itemId,
    });
    if (!result.ok) {
      setError(result.error.message);
      return;
    }
    // Reflect the new state without a round trip for the whole set.
    setKept((current) => {
      const next = new Set(current);
      const key = `${entry.kind}:${String(itemId)}`;
      if (result.value) next.add(key);
      else next.delete(key);
      return next;
    });
  }

  /** A star, and what it means, in the one place both item kinds share. */
  function keepButton(entry: DailySetEntry, itemId: number): React.JSX.Element {
    const isKept = kept.has(`${entry.kind}:${String(itemId)}`);
    return (
      <button
        title={isKept ? 'Remove from Kept' : 'Keep this'}
        aria-label={isKept ? 'Remove from Kept' : 'Keep this'}
        onClick={() => void toggleKept(entry)}
        style={{ padding: '4px 10px' }}
      >
        {isKept ? '★' : '☆'}
      </button>
    );
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
              <div className="row">
                {item.completed ? (
                  <span className="badge ready">done</span>
                ) : (
                  <>
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
                  </>
                )}
                {keepButton(item, item.card.card.id)}
              </div>
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
              <>
                <p className="card-body" style={{ marginTop: 12 }}>
                  {question.explanation}
                </p>
                <div className="row">{keepButton(item, question.id)}</div>
              </>
            )}
          </article>
        );
      })}
    </div>
  );
}

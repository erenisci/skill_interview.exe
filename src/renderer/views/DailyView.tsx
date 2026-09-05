import type { AnswerRating, FeedbackReason, FeedbackTarget } from '@shared/domain';
import { CHANNELS, type DailySet, type DailySetEntry } from '@shared/ipc';
import { useCallback, useEffect, useState } from 'react';
import { FlagMenu } from './FlagMenu';

/**
 * The daily set — FR-40 through FR-44. A card carries no correctness, so its two buttons
 * ask the only thing there is to ask: did this need real review, or was it already known.
 * A question's rating is derived instead: the option picked was correct, or it was not —
 * there is no third state to offer (ADR-0007).
 */

function ratingForQuestion(pickedCorrect: boolean): AnswerRating {
  return pickedCorrect ? 'good' : 'again';
}

/**
 * The day, read as material then questions rather than as two unrelated blocks.
 *
 * Today used to list every card and then every question, which is the order they happen to
 * be stored in, not the order they make sense in: a question is drawn from a card, so the
 * card should come first and its questions directly under it.
 *
 * A question whose card is not in today's set still has to appear, so it forms a group of
 * its own. That is ordinary — a card is due on its own schedule, and its questions on
 * theirs.
 */
interface DayGroup {
  readonly key: string;
  readonly card: Extract<DailySetEntry, { kind: 'card' }> | null;
  readonly questions: Extract<DailySetEntry, { kind: 'question' }>[];
}

export function groupDay(items: readonly DailySetEntry[]): DayGroup[] {
  const groups: DayGroup[] = [];
  const byCard = new Map<number, DayGroup>();

  for (const item of items) {
    if (item.kind !== 'card') continue;
    const group: DayGroup = { key: `card:${String(item.card.card.id)}`, card: item, questions: [] };
    byCard.set(item.card.card.id, group);
    groups.push(group);
  }

  let loose: DayGroup | null = null;
  for (const item of items) {
    if (item.kind !== 'question') continue;
    const owner = byCard.get(item.question.cardId);
    if (owner) {
      owner.questions.push(item);
      continue;
    }
    loose ??= { key: 'loose', card: null, questions: [] };
    loose.questions.push(item);
  }
  if (loose) groups.push(loose);

  return groups;
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

  /**
   * A card and the questions drawn from it are kept as one thing.
   *
   * Two stars, one for the card and one for each question, made it possible to keep a
   * question whose card was not kept — and an exported question with no material behind it
   * is a quiz, not a revision note. The main process owns the rule so the group can never be
   * half-kept ([`favorites:toggle-card`](../../main/ipc/index.ts)).
   */
  async function toggleKeptCard(cardId: number): Promise<void> {
    const result = await window.api.invoke(CHANNELS.favoritesToggleCard, cardId);
    if (!result.ok) {
      setError(result.error.message);
      return;
    }
    // The questions moved with it, so their stars have to as well. Reloading is cheaper to
    // reason about than mirroring the main process's rule a second time here.
    await load();
  }

  /**
   * A flagged question leaves rotation immediately: telling the user it is bad and then
   * showing it again tomorrow reads as the app ignoring them.
   */
  async function flag(
    questionId: number,
    reason: FeedbackReason,
    target: FeedbackTarget,
  ): Promise<void> {
    const result = await window.api.invoke(CHANNELS.questionsFlag, { questionId, target, reason });
    if (!result.ok) {
      setError(result.error.message);
      return;
    }
    await load();
  }

  /**
   * A question can also be kept on its own.
   *
   * The card's star is a shortcut for "this card and everything it asks"; this is the
   * precise version — keep the two questions that were worth keeping and leave the rest.
   * Both write to the same table, so a question kept either way is the same row.
   */
  async function toggleKeptQuestion(questionId: number): Promise<void> {
    const result = await window.api.invoke(CHANNELS.favoritesToggle, {
      itemType: 'question',
      itemId: questionId,
    });
    if (!result.ok) {
      setError(result.error.message);
      return;
    }
    setKept((current) => {
      const next = new Set(current);
      const key = `question:${String(questionId)}`;
      if (result.value) next.add(key);
      else next.delete(key);
      return next;
    });
  }

  function keepQuestionButton(questionId: number): React.JSX.Element {
    const isKept = kept.has(`question:${String(questionId)}`);
    return (
      <button
        className="keep"
        title={isKept ? 'Remove this question from Kept' : 'Keep this question'}
        aria-label={isKept ? 'Remove this question from Kept' : 'Keep this question'}
        onClick={() => void toggleKeptQuestion(questionId)}
      >
        {isKept ? '★' : '☆'}
      </button>
    );
  }

  function keepCardButton(cardId: number): React.JSX.Element {
    const isKept = kept.has(`card:${String(cardId)}`);
    return (
      <button
        className="keep"
        title={
          isKept ? 'Remove this and its questions from Kept' : 'Keep this and all its questions'
        }
        aria-label={isKept ? 'Remove from Kept' : 'Keep this and its questions'}
        onClick={() => void toggleKeptCard(cardId)}
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

      {groupDay(set.items).map((group) => (
        <section key={group.key} className="day-group">
          {group.card && renderCard(group.card)}
          {group.questions.map((q) => renderQuestion(q))}
        </section>
      ))}
    </div>
  );

  function renderCard(item: Extract<DailySetEntry, { kind: 'card' }>): React.JSX.Element {
    {
      const itemId = item.card.card.id;
      const key = `card:${String(itemId)}`;
      {
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
              {keepCardButton(item.card.card.id)}
            </div>
          </article>
        );
      }
    }
  }

  function renderQuestion(item: Extract<DailySetEntry, { kind: 'question' }>): React.JSX.Element {
    const question = item.question;
    const key = `question:${String(question.id)}`;
    const chosen = answered[question.id];
    const revealed = chosen !== undefined || item.completed;

    return (
      <article key={key} className="panel question-of">
        {/* The star is here rather than below the answer: keeping a question is not a verdict
            on it, and a reader may want to save one before working it out. Flagging is the
            opposite and stays behind the reveal. */}
        <div className="question-head">
          <p style={{ fontWeight: 600, margin: 0 }}>{question.stem}</p>
          {keepQuestionButton(question.id)}
        </div>
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
            {/* After the answer, not before: a verdict on a question the reader has not
                engaged with yet is not a verdict worth recording. */}
            <div className="row question-actions">
              <FlagMenu onFlag={(reason, target) => void flag(question.id, reason, target)} />
            </div>
          </>
        )}
      </article>
    );
  }
}

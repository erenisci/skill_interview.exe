import { CHANNELS, type FavoriteEntry } from '@shared/ipc';
import { useCallback, useEffect, useState } from 'react';

/**
 * What the user chose to keep, and the way it leaves the app.
 *
 * A favourite whose skill was deleted is shown as a tombstone rather than hidden: they
 * asked to keep it, and quietly dropping it from the list would be the app overruling that
 * (docs/product/feature-specs.md).
 */
export function FavoritesView(): React.JSX.Element {
  const [entries, setEntries] = useState<readonly FavoriteEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [draftNotes, setDraftNotes] = useState<Readonly<Record<number, string>>>({});

  const load = useCallback(async (cancelled?: () => boolean) => {
    const result = await window.api.invoke(CHANNELS.favoritesList, undefined);
    if (cancelled?.()) return;
    if (result.ok) setEntries(result.value);
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

  async function saveNote(entry: FavoriteEntry): Promise<void> {
    const note = draftNotes[entry.favorite.id];
    if (note === undefined) return;
    const result = await window.api.invoke(CHANNELS.favoritesNote, {
      itemType: entry.favorite.itemType,
      itemId: entry.favorite.itemId,
      note,
    });
    if (!result.ok) {
      setError(result.error.message);
      return;
    }
    setDraftNotes((drafts) => {
      const next = { ...drafts };
      delete next[entry.favorite.id];
      return next;
    });
    await load();
  }

  async function unfavorite(entry: FavoriteEntry): Promise<void> {
    const result = await window.api.invoke(CHANNELS.favoritesToggle, {
      itemType: entry.favorite.itemType,
      itemId: entry.favorite.itemId,
    });
    if (!result.ok) {
      setError(result.error.message);
      return;
    }
    await load();
  }

  async function exportAll(): Promise<void> {
    setBusy(true);
    setError(null);
    setStatus(null);
    const result = await window.api.invoke(CHANNELS.favoritesExport, undefined);
    setBusy(false);
    if (!result.ok) {
      setError(result.error.message);
      return;
    }
    // A dismissed save dialog is a decision, not an outcome worth announcing.
    if (result.value.path) setStatus('Exported.');
  }

  if (!entries && !error) return <p className="muted">Loading favourites…</p>;

  if (!entries || entries.length === 0) {
    return (
      <div className="panel empty">
        {error && <p className="error">{error}</p>}
        <p>Nothing kept yet.</p>
        <p className="muted" style={{ fontSize: 13 }}>
          Star a card or a question in today's set to keep it here, and export the lot as Markdown
          when you want it outside the app.
        </p>
      </div>
    );
  }

  return (
    <div>
      <div className="row" style={{ justifyContent: 'space-between', marginBottom: 16 }}>
        <span className="muted">
          {entries.length} kept {entries.length === 1 ? 'item' : 'items'}
        </span>
        <span className="row">
          {status && <span className="muted">{status}</span>}
          <button className="primary" disabled={busy} onClick={() => void exportAll()}>
            {busy ? 'Exporting…' : 'Export as Markdown'}
          </button>
        </span>
      </div>

      {error && <p className="error">{error}</p>}

      {entries.map((entry) => {
        const draft = draftNotes[entry.favorite.id];
        const note = draft ?? entry.favorite.note ?? '';

        return (
          <article key={entry.favorite.id} className="panel">
            {entry.kind === 'orphaned' ? (
              <>
                <h3 style={{ marginTop: 0 }}>A {entry.favorite.itemType} you kept</h3>
                <p className="muted">
                  The skill this belonged to has been removed, so its content is gone. The note
                  below is kept, and it still appears in an export.
                </p>
              </>
            ) : (
              <>
                <p className="muted" style={{ marginTop: 0, fontSize: 12 }}>
                  {entry.skill.name}
                </p>
                {entry.kind === 'card' ? (
                  <>
                    <h3 style={{ marginTop: 0 }}>{entry.card.title}</h3>
                    <p className="card-body">{entry.card.bodyMd}</p>
                    {entry.sources.length > 0 && (
                      <p className="muted" style={{ fontSize: 12 }}>
                        Sources —{' '}
                        {entry.sources.map((source, i) => (
                          <span key={source.id}>
                            {i > 0 && ' · '}
                            <a href={source.url} target="_blank" rel="noreferrer">
                              {source.title}
                            </a>
                          </span>
                        ))}
                      </p>
                    )}
                  </>
                ) : (
                  <>
                    <h3 style={{ marginTop: 0 }}>{entry.question.stem}</h3>
                    <ul className="list" style={{ gap: 2 }}>
                      {entry.question.options.map((option) => (
                        <li key={option.id} style={{ padding: '4px 2px' }}>
                          <span>
                            {option.isCorrect ? '✓ ' : '　'}
                            {option.text}
                          </span>
                          <span className="muted" style={{ fontSize: 12 }}>
                            {option.rationale}
                          </span>
                        </li>
                      ))}
                    </ul>
                    <p className="card-body">{entry.question.explanation}</p>
                  </>
                )}
              </>
            )}

            <div className="row" style={{ marginTop: 12 }}>
              <input
                style={{ flex: 1 }}
                placeholder="Add a note…"
                value={note}
                onChange={(e) =>
                  setDraftNotes({ ...draftNotes, [entry.favorite.id]: e.target.value })
                }
              />
              <button disabled={draft === undefined} onClick={() => void saveNote(entry)}>
                Save note
              </button>
              <button onClick={() => void unfavorite(entry)}>Remove</button>
            </div>
          </article>
        );
      })}
    </div>
  );
}

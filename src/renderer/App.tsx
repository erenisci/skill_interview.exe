import type { SystemStatus } from '@shared/domain';
import { CHANNELS } from '@shared/ipc';
import { useCallback, useEffect, useState } from 'react';
import { DailyView } from './views/DailyView';
import { FavoritesView } from './views/FavoritesView';
import { SettingsView } from './views/SettingsView';
import { SetupView } from './views/SetupView';
import { SkillsView } from './views/SkillsView';

type Tab = 'today' | 'skills' | 'kept' | 'settings';

type Load =
  | { state: 'loading' }
  | { state: 'ready'; status: SystemStatus }
  | { state: 'error'; message: string };

export function App(): React.JSX.Element {
  const [load, setLoad] = useState<Load>({ state: 'loading' });
  const [bypassSetup, setBypassSetup] = useState(false);
  const [tab, setTab] = useState<Tab>('today');

  const refresh = useCallback(async (cancelled?: () => boolean) => {
    const result = await window.api.invoke(CHANNELS.systemStatus, undefined);
    if (cancelled?.()) return;
    setLoad(
      result.ok
        ? { state: 'ready', status: result.value }
        : { state: 'error', message: result.error.message },
    );
  }, []);

  useEffect(() => {
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the main process is the external system this subscribes to; setState runs after the await, and the guard covers unmount
    void refresh(() => cancelled);
    return () => {
      cancelled = true;
    };
  }, [refresh]);

  if (load.state === 'loading') {
    return (
      <div className="app">
        <p className="muted">Starting…</p>
      </div>
    );
  }

  if (load.state === 'error') {
    return (
      <div className="app">
        <h1>skill_interview.exe</h1>
        <p className="error">Could not read system status: {load.message}</p>
      </div>
    );
  }

  // A missing runtime or model routes to setup rather than into a half-working app.
  // Generation is split from consumption, though, so the rest is still buildable and
  // usable without a model — hence the explicit bypass.
  const needsSetup = load.status.llm.state !== 'ready';
  if (needsSetup && !bypassSetup) {
    return (
      <SetupView
        status={load.status}
        onRetry={() => refresh()}
        onContinueAnyway={() => setBypassSetup(true)}
      />
    );
  }

  return (
    <div className="app">
      <div className="row" style={{ marginBottom: 24 }}>
        <button className={tab === 'today' ? 'primary' : ''} onClick={() => setTab('today')}>
          Today
        </button>
        <button className={tab === 'skills' ? 'primary' : ''} onClick={() => setTab('skills')}>
          Skills
        </button>
        <button className={tab === 'kept' ? 'primary' : ''} onClick={() => setTab('kept')}>
          Kept
        </button>
        <button className={tab === 'settings' ? 'primary' : ''} onClick={() => setTab('settings')}>
          Settings
        </button>
      </div>
      {tab === 'today' && <DailyView />}
      {tab === 'skills' && (
        <SkillsView status={load.status} onOpenSetup={() => setBypassSetup(false)} />
      )}
      {tab === 'kept' && <FavoritesView />}
      {tab === 'settings' && <SettingsView status={load.status} onChanged={() => refresh()} />}
    </div>
  );
}

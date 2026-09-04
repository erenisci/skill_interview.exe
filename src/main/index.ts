import { app, BrowserWindow, session, shell } from 'electron';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { createContext, type AppContext } from './context';
import { registerIpc } from './ipc';
import { startReminder } from './notify';
import { iconPath } from './util/assets';
import { resolveDataDir } from './util/data-dir';
import { log } from './util/logger';

let context: AppContext | null = null;
let stopReminder: (() => void) | null = null;
let mainWindow: BrowserWindow | null = null;

/**
 * Set the moment a real quit begins, so the close handler stops intercepting.
 *
 * Without it, hiding on close would make the app unquittable: `app.quit()` closes every
 * window, the handler cancels each close, and the quit never completes.
 */
let quitting = false;

/**
 * Set as a header rather than a meta tag so dev and release can differ: Vite's dev server
 * needs inline scripts and a websocket for HMR, and the packaged app must allow neither.
 * Remote script is blocked in both.
 */
function applyCsp(devServer: string | undefined): void {
  const policy = devServer
    ? "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self' ws://localhost:* http://localhost:*"
    : "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'";

  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [policy],
      },
    });
  });
}

function createWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1100,
    height: 760,
    minWidth: 880,
    minHeight: 600,
    show: false,
    // Matches --bg in the renderer stylesheet, so the first paint is not a white flash.
    backgroundColor: '#0d1117',
    title: 'skill_interview.exe',
    // Without this the window and taskbar show Electron's default gear. A packaged build
    // takes its icon from the executable, so this is what a development run needs — but it
    // is set unconditionally, because an app that looks like Electron while you are
    // building it is an app you stop noticing the icon of.
    icon: iconPath(),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      // Non-negotiable: the renderer displays text derived from arbitrary web pages
      // (docs/operations/security.md).
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webviewTag: false,
    },
  });

  window.once('ready-to-show', () => window.show());

  // External links open in the system browser, never in an app window.
  window.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: 'deny' };
  });

  const devServer = process.env['ELECTRON_RENDERER_URL'];
  if (devServer) void window.loadURL(devServer);
  else void window.loadFile(join(__dirname, '../renderer/index.html'));

  // Closing hides rather than quits, unless the user turned that off or a real quit is
  // already under way. The window is kept — reopening from the tray is then instant, and
  // it is also what makes the reminder work at all: a notification at 18:00 needs a
  // process at 18:00 (docs/operations/configuration.md).
  window.on('close', (event) => {
    if (quitting) return;
    if (context?.settings.get('close_to_tray') !== 'true') return;
    event.preventDefault();
    window.hide();
  });

  mainWindow = window;
  window.on('closed', () => {
    if (mainWindow === window) mainWindow = null;
  });
  return window;
}

/**
 * Registers or clears the Windows login item to match the setting.
 *
 * Packaged builds only. In development the executable is Electron's own binary inside
 * `node_modules`, and adding *that* to a machine's startup would be a genuinely unpleasant
 * thing to leave behind on a contributor's computer.
 *
 * `--hidden` is passed so a login launch goes straight to the tray. An app that appears at
 * boot because it will remind you at six o'clock has misunderstood its own job.
 */
function applyLaunchAtStartup(enabled: boolean): void {
  if (!app.isPackaged) return;
  app.setLoginItemSettings({ openAtLogin: enabled, args: ['--hidden'] });
}

/** Brings the window forward — a reminder notification does nothing useful otherwise. */
function focusMainWindow(): void {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  } else {
    createWindow();
  }
}

/**
 * Windows will not show a notification from a process it cannot identify.
 *
 * Electron's `Notification` silently does nothing on Windows unless the AppUserModelID is
 * set and matches the one the installer registered — so the reminder, the one feature that
 * makes this a daily habit, was firing into nothing. It has to match `appId` in
 * `electron-builder.yml`, which is why the string is duplicated with that warning attached
 * rather than imported from somewhere clever: the build config is YAML the main process
 * cannot read at run time.
 */
const APP_USER_MODEL_ID = 'dev.erenisci.skill-interview';

app.whenReady().then(() => {
  app.setAppUserModelId(APP_USER_MODEL_ID);
  // The resolved path is never logged below: the default `userData` path contains the
  // Windows username, which the logging rules forbid outright regardless of build mode
  // (docs/operations/logging.md). `source` alone is enough to tell a stray override from a
  // broken default.
  const { path: dataDir, source: dataDirSource } = resolveDataDir(app.getPath('userData'));
  try {
    // Electron creates `userData` itself; a `SKILL_INTERVIEW_DATA_DIR` override may not
    // exist yet, and better-sqlite3 cannot open a database whose parent directory is
    // missing.
    mkdirSync(dataDir, { recursive: true });
    context = createContext(dataDir);
  } catch (cause) {
    // A migration failure, or the database directory itself being unusable, is fatal: the
    // app must refuse to start rather than run on a half-migrated or missing database
    // (docs/operations/error-handling.md).
    const detail = cause instanceof Error ? cause.message : String(cause);
    log.error('db', 'startup failed', { detail, dataDirSource });
    app.exit(1);
    return;
  }

  log.info('app', 'started', {
    version: app.getVersion(),
    electron: process.versions.electron,
    dataDirSource,
  });
  applyCsp(process.env['ELECTRON_RENDERER_URL']);
  registerIpc(context, app.getVersion(), { setLaunchAtStartup: applyLaunchAtStartup });
  applyLaunchAtStartup(context.settings.get('launch_at_startup') === 'true');
  context.queue.start();
  stopReminder = startReminder(context, focusMainWindow, () => {
    // Quit from the tray is the one path that must always end the process, so it says so
    // before asking for it.
    quitting = true;
    app.quit();
  });
  // Started by the login item: the tray icon is the whole point, so nothing is shown.
  if (!process.argv.includes('--hidden')) createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  // Only reached when the window genuinely closed, which close-to-tray prevents.
  if (process.platform !== 'darwin') app.quit();
});

// Covers every other way a quit can start — the tray's Quit, a Windows shutdown, Cmd+Q —
// so none of them is cancelled by the close handler above.
app.on('before-quit', () => {
  quitting = true;
});

app.on('will-quit', () => {
  stopReminder?.();
  // Stopping the queue releases the model, so a closing app does not leave gigabytes
  // resident (docs/operations/performance.md).
  void context?.queue.stop();
  context?.db.close();
  log.info('app', 'stopped');
});

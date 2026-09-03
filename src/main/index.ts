import { app, BrowserWindow, session, shell } from 'electron';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { createContext, type AppContext } from './context';
import { registerIpc } from './ipc';
import { startReminder } from './notify';
import { resolveDataDir } from './util/data-dir';
import { log } from './util/logger';

let context: AppContext | null = null;
let stopReminder: (() => void) | null = null;
let mainWindow: BrowserWindow | null = null;

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
    backgroundColor: '#12131a',
    title: 'skill_interview.exe',
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

  mainWindow = window;
  window.on('closed', () => {
    if (mainWindow === window) mainWindow = null;
  });
  return window;
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

app.whenReady().then(() => {
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
  registerIpc(context, app.getVersion());
  context.queue.start();
  stopReminder = startReminder(context, focusMainWindow);
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('will-quit', () => {
  stopReminder?.();
  // Stopping the queue releases the model, so a closing app does not leave gigabytes
  // resident (docs/operations/performance.md).
  void context?.queue.stop();
  context?.db.close();
  log.info('app', 'stopped');
});

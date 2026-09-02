import { join } from 'node:path';
import { app, BrowserWindow, session, shell } from 'electron';
import { createContext, type AppContext } from './context';
import { registerIpc } from './ipc';
import { log } from './util/logger';

let context: AppContext | null = null;

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

  return window;
}

app.whenReady().then(() => {
  try {
    context = createContext(app.getPath('userData'));
  } catch (cause) {
    // A migration failure is fatal: the app must refuse to start rather than run on a
    // half-migrated database (docs/operations/error-handling.md).
    const detail = cause instanceof Error ? cause.message : String(cause);
    log.error('db', 'startup failed', { detail });
    app.exit(1);
    return;
  }

  log.info('app', 'started', { version: app.getVersion(), electron: process.versions.electron });
  applyCsp(process.env['ELECTRON_RENDERER_URL']);
  registerIpc(context, app.getVersion());
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('will-quit', () => {
  context?.db.close();
  log.info('app', 'stopped');
});

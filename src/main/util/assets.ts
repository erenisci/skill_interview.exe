import { app } from 'electron';
import { join } from 'node:path';

/**
 * Where a shipped asset lives, which differs between a development run and a packaged one.
 *
 * In development the file sits in the repository; packaged, `extraResources` copies it
 * beside the app, which is what `process.resourcesPath` points at.
 *
 * This lives in `util/` rather than in `index.ts` because both the window and the tray need
 * it, and having `notify/` import from `index.ts` — which imports `notify/` — is a circular
 * import in the main process, where the cost is a module that is half-initialised at the
 * moment something reads it.
 */
export function assetPath(fileName: string): string {
  return app.isPackaged
    ? join(process.resourcesPath, fileName)
    : join(app.getAppPath(), 'resources', fileName);
}

/** The app's own icon. One file, so the window, the taskbar and the tray cannot disagree. */
export function iconPath(): string {
  return assetPath('icon.png');
}

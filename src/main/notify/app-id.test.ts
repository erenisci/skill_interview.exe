import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The one string that has to be identical in two files written in two languages.
 *
 * Windows shows a notification only from a process whose AppUserModelID it recognises, and
 * it recognises the one the installer registered. If `app.setAppUserModelId()` and
 * `electron-builder.yml`'s `appId` ever drift apart, `new Notification(...).show()` keeps
 * returning quietly and the reminder — the feature that makes this a daily habit rather
 * than an app you forget — stops arriving, with nothing in any log to say so.
 *
 * The main process cannot read the build YAML at run time, so the value is duplicated. This
 * is what stops the duplicate becoming a divergence.
 */
const ROOT = join(__dirname, '..', '..', '..');

function read(relative: string): string {
  return readFileSync(join(ROOT, relative), 'utf8');
}

describe('the Windows application identity', () => {
  it('matches between the main process and the installer config', () => {
    const fromBuild = /^appId:\s*(\S+)\s*$/m.exec(read('electron-builder.yml'))?.[1];
    const fromMain = /const APP_USER_MODEL_ID = '([^']+)'/.exec(read('src/main/index.ts'))?.[1];

    expect(fromBuild).toBeDefined();
    expect(fromMain).toBeDefined();
    expect(fromMain).toBe(fromBuild);
  });

  it('is actually applied at startup, not merely declared', () => {
    // A constant nothing calls would pass the check above and still show no notifications.
    expect(read('src/main/index.ts')).toContain('app.setAppUserModelId(APP_USER_MODEL_ID)');
  });
});

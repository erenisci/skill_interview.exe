import {
  _electron as electron,
  expect,
  type ElectronApplication,
  type Page,
} from '@playwright/test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * Launching the built app against a database of its own.
 *
 * Each run gets a fresh directory through `SKILL_INTERVIEW_DATA_DIR`, which exists for
 * exactly this ([env-vars.md](../docs/operations/env-vars.md)). Without it a test would open
 * the developer's real database, and a test that can delete someone's skills is worse than
 * no test.
 *
 * These tests do not care whether Ollama is running. The app reads `ollama_url` from its own
 * settings, not from the environment, so there is nothing honest to override — and it should
 * not matter: with a model the setup screen is skipped, without one it appears and is
 * dismissed. `skipSetup` handles both, so a developer with Ollama up and a CI runner without
 * it exercise the same flows.
 */
export interface Launched {
  readonly app: ElectronApplication;
  readonly window: Page;
  readonly dataDir: string;
  close(): Promise<void>;
}

/**
 * Pass an existing `dataDir` to relaunch against the same database — the only way to prove
 * something was written to disk rather than held in React state.
 */
/**
 * Strips `ELECTRON_RUN_AS_NODE`, which turns the Electron binary into a plain Node process.
 *
 * Some toolchains set it, and inheriting it here is silent and total: `require(electron)`
 * then resolves to the npm package rather than the built-in module, `app` is undefined, and
 * the process dies before a window exists. Playwright reports only "Process failed to
 * launch", which sends you looking at the build.
 */
function withoutRunAsNode(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const copy = { ...env };
  delete copy.ELECTRON_RUN_AS_NODE;
  return copy;
}

export async function launchApp(existingDataDir?: string): Promise<Launched> {
  const dataDir = existingDataDir ?? mkdtempSync(join(tmpdir(), 'skill-interview-e2e-'));
  const ownsDir = existingDataDir === undefined;

  const app = await electron.launch({
    args: ['out/main/index.js'],
    env: {
      ...withoutRunAsNode(process.env),
      SKILL_INTERVIEW_DATA_DIR: dataDir,
    },
  });

  const window = await app.firstWindow();
  await window.waitForLoadState('domcontentloaded');

  return {
    app,
    window,
    dataDir,
    async close() {
      await app.close();
      // A relaunch borrows the directory; only the first launch may delete it.
      if (ownsDir) rmSync(dataDir, { recursive: true, force: true });
    },
  };
}

/**
 * Waits for the app to settle into one of its two opening states, then gets past the first.
 *
 * Readiness is an async probe of Ollama, so for a moment after launch neither the setup
 * screen nor the navigation exists. Checking for the setup button immediately is a race: on a
 * fast run nothing is there yet, the click is skipped, the setup screen appears a beat later,
 * and every selector after it fails. That is the kind of flake that changes which tests fail
 * between runs — worse than a test that simply fails, because it teaches you to ignore the
 * suite.
 *
 * So this waits for whichever of the two arrives, and only then decides what to do.
 */
export async function skipSetup(window: Page): Promise<void> {
  const carryOn = window.getByRole('button', { name: 'Continue without a model' });
  const nav = window.getByRole('button', { name: 'Skills' });

  await expect(carryOn.or(nav).first()).toBeVisible({ timeout: 15_000 });

  if (await carryOn.isVisible()) {
    await carryOn.click();
    await expect(nav).toBeVisible();
  }
}

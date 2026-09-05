import { expect, test } from '@playwright/test';
import { launchApp, skipSetup, type Launched } from './app';

/**
 * The window, its navigation, and the IPC underneath.
 *
 * Every assertion here covers something that stays green in the unit suite while being
 * broken on screen. A channel renamed on one side of the preload boundary, a handler whose
 * `Result` the view never unwraps, a tab that renders nothing — the main process passes its
 * own tests in all three cases.
 */

let app: Launched;

test.beforeEach(async () => {
  app = await launchApp();
});

test.afterEach(async () => {
  await app.close();
});

test('opens a window and reaches the app', async () => {
  await skipSetup(app.window);
  await expect(app.window.getByRole('button', { name: 'Skills' })).toBeVisible();
});

test('every tab renders something', async () => {
  // Not a formality: a tab whose view throws renders an empty panel, and nothing below the
  // window notices. Each of these asserts on content the view itself owns.
  await skipSetup(app.window);

  await app.window.getByRole('button', { name: 'Skills' }).click();
  await expect(app.window.getByRole('heading', { name: 'Skills' })).toBeVisible();

  await app.window.getByRole('button', { name: 'Today' }).click();
  await expect(app.window.locator('.panel, .empty').first()).toBeVisible();

  await app.window.getByRole('button', { name: 'Kept' }).click();
  await expect(app.window.locator('.panel, .empty').first()).toBeVisible();

  await app.window.getByRole('button', { name: 'Settings' }).click();
  await expect(app.window.getByRole('heading', { name: 'Settings' })).toBeVisible();
});

test('the version footer reads real values from the main process', async () => {
  // The schema version comes from a migration query, so a number here proves the database
  // opened, migrated and answered over IPC.
  await skipSetup(app.window);
  await app.window.getByRole('button', { name: 'Skills' }).click();
  await expect(app.window.getByText(/schema \d+/)).toBeVisible();
});

test('an empty database says so rather than showing an empty panel', async () => {
  await skipSetup(app.window);

  await app.window.getByRole('button', { name: 'Skills' }).click();
  await expect(app.window.getByText(/no skills yet/i)).toBeVisible();

  await app.window.getByRole('button', { name: 'Kept' }).click();
  await expect(app.window.getByText(/star a card or a question/i)).toBeVisible();
});

import { expect, test } from '@playwright/test';
import { launchApp, skipSetup, type Launched } from './app';

/**
 * Adding a skill, and the settings that survive a restart.
 *
 * These are round trips: the renderer writes through IPC, the main process validates and
 * stores, and the renderer reads back what was actually kept. A unit test can prove each
 * half and still miss the join — which is where a "Check again" button that did nothing
 * lived, and a settings field whose refusal never reached the screen.
 */

let app: Launched;

test.beforeEach(async () => {
  app = await launchApp();
  await skipSetup(app.window);
  await app.window.getByRole('button', { name: 'Skills' }).click();
});

test.afterEach(async () => {
  await app.close();
});

test('a skill added on screen is stored and listed', async () => {
  await app.window.getByLabel('Skill name').fill('PostgreSQL');
  await app.window.getByRole('button', { name: 'Add' }).click();

  await expect(app.window.getByText('PostgreSQL')).toBeVisible();
  // Research is queued but cannot run without a model, so it settles as pending or failed.
  // Which of those it is depends on the machine; that it *has* a status does not.
  await expect(app.window.locator('.badge').first()).toBeVisible();
});

test('the same skill cannot be added twice', async () => {
  // FR-02, and the kind of rule that lives in the main process and is easy to leave
  // unwired in the view — the error has to reach the screen, not just be returned.
  await app.window.getByLabel('Skill name').fill('Redis');
  await app.window.getByRole('button', { name: 'Add' }).click();
  await expect(app.window.getByText('Redis')).toBeVisible();

  await app.window.getByLabel('Skill name').fill('redis');
  await app.window.getByRole('button', { name: 'Add' }).click();
  await expect(app.window.getByText(/already tracked/i)).toBeVisible();
});

test('a comma-separated list is refused with a reason', async () => {
  await app.window.getByLabel('Skill name').fill('nginx, Redis, Java');
  await app.window.getByRole('button', { name: 'Add' }).click();

  await expect(app.window.getByText(/one skill at a time/i)).toBeVisible();
  await expect(app.window.getByText(/no skills yet/i)).toBeVisible();
});

test('Add stays disabled until there is something to add', async () => {
  const add = app.window.getByRole('button', { name: 'Add' });
  await expect(add).toBeDisabled();

  await app.window.getByLabel('Skill name').fill('Kubernetes');
  await expect(add).toBeEnabled();
});

test('a removed skill leaves the list', async () => {
  await app.window.getByLabel('Skill name').fill('Traefik');
  await app.window.getByRole('button', { name: 'Add' }).click();
  await expect(app.window.getByText('Traefik')).toBeVisible();

  await app.window.getByRole('button', { name: 'Remove' }).first().click();
  await expect(app.window.getByText(/no skills yet/i)).toBeVisible();
});

test('a skill and a setting both survive a restart', async () => {
  // The round trip a unit test cannot make: written through IPC, stored on disk, read back
  // by a second process that shares nothing with the first except the database file.
  await app.window.getByLabel('Skill name').fill('HAProxy');
  await app.window.getByRole('button', { name: 'Add' }).click();
  await expect(app.window.getByText('HAProxy')).toBeVisible();

  await app.window.getByRole('button', { name: 'Settings' }).click();
  const time = app.window.getByLabel('Reminder time');
  await time.fill('07:30');
  await time.blur();
  // Waiting on the stored value rather than the transient "saved" label: the label is an
  // affordance, and what this asserts is that the write reached disk.
  await expect(time).toHaveValue('07:30');

  await app.app.close();

  const again = await launchApp(app.dataDir);
  try {
    await skipSetup(again.window);

    await again.window.getByRole('button', { name: 'Settings' }).click();
    await expect(again.window.getByLabel('Reminder time')).toHaveValue('07:30');

    await again.window.getByRole('button', { name: 'Skills' }).click();
    await expect(again.window.getByText('HAProxy')).toBeVisible();
  } finally {
    await again.close();
  }
});

test('a cleared reminder time is refused, and the stored one survives', async () => {
  // The failure this validation exists to prevent is silent: a `reminder_time` the parser
  // cannot read makes `isReminderDue` return false forever, and the reminder simply stops
  // arriving with nothing on screen to say why.
  //
  // Clearing the field is the way a user actually reaches that — a native time input will not
  // hold "half six", so the only unparseable value it can produce is the empty one. An earlier
  // version of this test assigned the invalid string to the DOM node directly, which tested a
  // state no user can get to and asserted a repaint the uncontrolled input never does.
  await app.window.getByRole('button', { name: 'Settings' }).click();

  const time = app.window.getByLabel('Reminder time');
  await time.fill('07:30');
  await time.blur();
  await expect(time).toHaveValue('07:30');

  await time.fill('');
  await time.blur();
  await expect(app.window.getByText(/reminder time must be HH:MM/i)).toBeVisible();

  // The field is uncontrolled, so leaving Settings and coming back remounts it from what was
  // actually stored — which is the point: the refusal reached the screen without the refused
  // value reaching the database.
  await app.window.getByRole('button', { name: 'Skills' }).click();
  await app.window.getByRole('button', { name: 'Settings' }).click();
  await expect(app.window.getByLabel('Reminder time')).toHaveValue('07:30');
});

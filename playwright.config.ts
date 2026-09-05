import { defineConfig } from '@playwright/test';

/**
 * End-to-end tests, which here means **through the window**.
 *
 * Everything below the window already has 421 tests. What those cannot see is the layer this
 * one covers, and it is not a hypothetical gap: on 2026-09-04 and 05 a first real session
 * with the app produced seven defects, and not one of them was reachable from a test that
 * does not open a window. A channel name mismatched between preload and main leaves the main
 * process green and the button dead. An empty state can lie fluently while every function it
 * calls returns correctly.
 *
 * **No model, no network.** The app is built to run with neither — generation is stubbed and
 * everything else works, which is rule 1 doing its job — so these tests exercise the shell,
 * the IPC wiring and the flows, and never wait on Ollama. Research and generation are
 * measured by the eval suite instead, against a real model and frozen sources.
 *
 * Serial and single-worker on purpose: each test drives one Electron instance against one
 * SQLite file, and parallel workers would fight over both.
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env['CI'],
  retries: 0,
  reporter: process.env['CI'] ? [['github'], ['list']] : [['list']],
  timeout: 30_000,
  expect: { timeout: 8_000 },
});

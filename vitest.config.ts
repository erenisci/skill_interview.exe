import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: { alias: { '@shared': resolve('src/shared') } },
  test: {
    environment: 'node',
    /**
     * `evals/` is included because the eval harness's deterministic scorers are ordinary
     * pure functions and belong in the ordinary suite — a scorer that quietly mis-counts
     * would corrupt every quality number the project records. The eval *run* itself is
     * not a test: it needs a real model, so it lives behind `npm run eval`.
     */
    include: ['src/**/*.test.ts', 'evals/**/*.test.ts'],
  },
});

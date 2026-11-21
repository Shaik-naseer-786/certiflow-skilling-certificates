import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globalSetup: ['tests/globalSetup.ts'], // migrates the test schema once
    setupFiles: ['tests/env.ts'], // points every test file at the test schema
    fileParallelism: false, // test files share one database, so run them one by one
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});

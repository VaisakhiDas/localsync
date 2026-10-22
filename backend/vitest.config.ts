import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globalSetup: ['./src/test/globalSetup.ts'],
    // Integration tests start real servers and (later) a real PostgreSQL.
    testTimeout: 20_000,
    hookTimeout: 60_000,
    fileParallelism: false,
  },
});

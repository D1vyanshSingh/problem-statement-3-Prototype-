import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    testTimeout: 30_000,
    hookTimeout: 60_000,
    pool: 'forks',
    poolOptions: { forks: { singleFork: true } },
    env: {
      PORT: '8090',
      EMBEDDED_PG_PORT: '54330',
      EMBEDDED_PG_DIR: './.data/pg-test',
      CHAOS_ENABLED: 'false',
    },
  },
});

import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: { conditions: ['development'] },
  test: { include: ['packages/**/*.test.ts', 'tests/**/*.test.ts'], testTimeout: 15_000 },
});

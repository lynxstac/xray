import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['packages/*/test/**/*.test.ts', 'apps/web/src/**/*.test.ts'],
    exclude: ['fixtures/**', '**/node_modules/**'],
  },
});

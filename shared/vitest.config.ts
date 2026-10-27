import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.spec.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.spec.ts'],
      thresholds: { lines: 80, statements: 80, functions: 80, branches: 80 },
    },
  },
});

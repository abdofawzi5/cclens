import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/interfaces/cli/main.ts'],
      thresholds: {
        lines: 85,
        functions: 85,
        branches: 75,
        'src/core/**/*.ts': { lines: 95, functions: 95, branches: 85 },
      },
    },
  },
});

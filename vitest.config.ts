import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    // Same output on every machine: CI runs in UTC and picocolors turns colour on when CI is set.
    env: { TZ: 'UTC', NO_COLOR: '1' },
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

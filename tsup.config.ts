import { readFileSync } from 'node:fs';
import { defineConfig } from 'tsup';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as {
  version: string;
};

export default defineConfig({
  entry: { cli: 'src/interfaces/cli/main.ts', index: 'src/index.ts' },
  format: ['esm'],
  target: 'node20',
  platform: 'node',
  dts: { entry: { index: 'src/index.ts' } },
  clean: true,
  sourcemap: true,
  define: { __CCLENS_VERSION__: JSON.stringify(pkg.version) },
});

import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import type { ScriptAsset } from '../../core/ports/infrastructure.js';

/**
 * Chart.js's UMD build, read from the installed `chart.js` package so reports can
 * inline it and open offline. The source-map comment is dropped so the browser
 * never tries to fetch a map file.
 */
export class ChartJsAsset implements ScriptAsset {
  readonly name = 'Chart.js';
  readonly license = 'MIT';
  private cached?: string;

  constructor(private readonly path: string = ChartJsAsset.defaultPath()) {}

  static defaultPath(): string {
    // `chart.js` resolves to dist/chart.cjs; the UMD build sits next to it.
    const require = createRequire(import.meta.url);
    return join(dirname(require.resolve('chart.js')), 'chart.umd.min.js');
  }

  async source(): Promise<string> {
    this.cached ??= (await readFile(this.path, 'utf8'))
      .replace(/\n?\/\/# sourceMappingURL=\S+\s*$/, '\n')
      .trimEnd();
    return this.cached;
  }
}

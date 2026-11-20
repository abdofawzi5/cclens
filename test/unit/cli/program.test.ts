import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { resolvePaths } from '../../../src/adapters/system/paths.js';
import { createContainer } from '../../../src/composition-root.js';
import { buildProgram } from '../../../src/interfaces/cli/program.js';
import { InMemoryConfigStore } from '../../support/in-memory-config-store.js';

async function run(args: string[]): Promise<string> {
  const lines: string[] = [];
  const container = createContainer({
    overrides: { paths: resolvePaths({}, '/home/u'), configStore: new InMemoryConfigStore() },
  });
  const program = buildProgram(container, '1.2.3', (t) => lines.push(t)).exitOverride();
  await program.parseAsync(['node', 'cclens', ...args]);
  return lines.join('\n');
}

describe('cli program', () => {
  it('prints paths as JSON', async () => {
    const out = JSON.parse(await run(['--json', 'paths'])) as Record<string, string>;
    expect(out['home']).toBe(join('/home/u', '.cclens'));
  });

  it('prints paths as aligned text', async () => {
    const configFile = join('/home/u', '.cclens', 'config.json');
    expect(await run(['paths'])).toMatch(
      new RegExp(`configFile\\s+${configFile.replace(/[\\^$.*+?()[\]{}|/]/g, '\\$&')}`),
    );
  });

  it('shows and validates config', async () => {
    const shown = JSON.parse(await run(['--json', 'config', 'show'])) as { version: number };
    expect(shown.version).toBe(1);
    expect(await run(['config', 'validate'])).toBe('Config is valid.');
    expect(await run(['config', 'path'])).toBe('/virtual/config.json');
  });
});

import { stripVTControlCharacters as strip } from 'node:util';
import { describe, expect, it } from 'vitest';
import { resolvePaths } from '../../../src/adapters/system/paths.js';
import { createContainer } from '../../../src/composition-root.js';
import { buildProgram } from '../../../src/interfaces/cli/program.js';
import { MemorySpendStore, RecordingRunner } from '../../support/budget.js';
import { FixedClock, MemoryEventStore } from '../../support/fakes.js';
import { FakeTokens } from '../../support/fake-tokens.js';
import { InMemoryConfigStore } from '../../support/in-memory-config-store.js';

function harness() {
  const configStore = new InMemoryConfigStore();
  const spendStore = new MemorySpendStore();
  const container = createContainer({
    overrides: {
      paths: resolvePaths({}, '/Users/me'),
      clock: new FixedClock(),
      configStore,
      eventStore: new MemoryEventStore(),
      tokens: new FakeTokens(),
      spendStore,
      background: new RecordingRunner(),
    },
  });
  const run = async (args: string[]): Promise<string> => {
    const lines: string[] = [];
    await buildProgram(container, '1.0.0', (t) => lines.push(t))
      .exitOverride()
      .parseAsync(['node', 'cclens', ...args]);
    return strip(lines.join('\n'));
  };
  return { run, configStore, spendStore };
}

describe('budget command', () => {
  it('sets limits and shows spend against them', async () => {
    const { run, configStore } = harness();
    expect(await run(['budget', 'set', '--daily', '$1', '--monthly', '100'])).toContain(
      'Budget: daily $1.00, monthly $100; warns when passed.',
    );
    expect(configStore.saved?.budget).toEqual({ daily: 1, monthly: 100, warnAt: 100 });
    const out = await run(['budget']);
    expect(out).toMatch(/Today\s+█+ \$2\.00 of \$1\.00 \(200%\)\s+over/);
    expect(out).toMatch(/This month █░+ \$3\.00 of \$100 \(3%\)/);
    expect(out).toContain('Estimated at API list prices');
  });

  it('clears limits, refreshes quietly and prints JSON', async () => {
    const { run, configStore, spendStore } = harness();
    await run(['budget', 'set', '--warn-at', '80']);
    expect(await run(['budget', 'clear'])).toContain('Budget cleared');
    expect(configStore.saved?.budget).toEqual({ warnAt: 80 });
    expect(await run(['budget', 'refresh'])).toBe('');
    expect(spendStore.value?.todayUsd).toBe(2);
    const json = JSON.parse(await run(['--json', 'budget'])) as { statuses: unknown[] };
    expect(json.statuses).toEqual([]);
  });

  it('rejects bad amounts', async () => {
    const { run } = harness();
    await expect(run(['budget', 'set', '--daily', '-5'])).rejects.toThrow();
    await expect(run(['budget', 'set', '--warn-at', '150'])).rejects.toThrow();
  });
});

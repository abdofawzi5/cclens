import { stripVTControlCharacters as strip } from 'node:util';
import { describe, expect, it } from 'vitest';
import { resolvePaths } from '../../../src/adapters/system/paths.js';
import { createContainer } from '../../../src/composition-root.js';
import { buildProgram } from '../../../src/interfaces/cli/program.js';
import { FixedClock, MemoryEventStore } from '../../support/fakes.js';
import { FakeTokens } from '../../support/fake-tokens.js';
import { InMemoryConfigStore } from '../../support/in-memory-config-store.js';
import { counts } from '../../support/review.js';

async function run(args: string[], pricesFail = false): Promise<string> {
  const reads: (Date | undefined)[] = [];
  const container = createContainer({
    overrides: {
      paths: resolvePaths({}, '/Users/me'),
      clock: new FixedClock(new Date(2026, 10, 19, 12)),
      configStore: new InMemoryConfigStore(),
      eventStore: new MemoryEventStore(),
      tokens: new FakeTokens(),
      skillSource: { id: 'fake', list: () => Promise.resolve([]) },
      activitySource: { read: () => Promise.resolve([]) },
      agentSource: {
        id: 'fake',
        list: () =>
          Promise.resolve([
            {
              id: 'kit:hunter',
              name: 'hunter',
              scope: 'plugin',
              plugin: 'kit',
              model: 'haiku',
              description: 'Finds bugs',
            },
          ]),
      },
      agentActivity: {
        read: (since) => {
          reads.push(since);
          const c = counts({ input: 4 });
          return Promise.resolve({
            runs: [
              {
                sessionId: 'expensive',
                project: '-Users-me-Workspace-site',
                agentId: 'a1',
                agentType: 'general-purpose',
                start: new Date('2026-11-19T08:00:00Z'),
                end: new Date('2026-11-19T08:05:00Z'),
                counts: c,
                byModel: [{ model: 'm', counts: c }],
              },
            ],
            calls: new Map([['general-purpose', 2]]),
          });
        },
      },
      prices: {
        load: () =>
          pricesFail
            ? Promise.reject(new Error('offline'))
            : Promise.resolve({
                price: () => ({ input: 1, output: 1, cacheCreation: 1, cacheRead: 1 }),
              }),
      },
    },
  });
  const lines: string[] = [];
  await buildProgram(container, '1.0.0', (t) => lines.push(t))
    .exitOverride()
    .parseAsync(['node', 'cclens', ...args]);
  return strip(lines.join('\n'));
}

describe('agents command', () => {
  it('shows calls, runs, tokens and priced cost per agent type', async () => {
    const out = await run(['agents']);
    expect(out).toContain('2 agent calls, 1 runs, 4 tokens, $4.00 estimated (since 10/20/2026)');
    expect(out).toContain('1 installed agents, 1 unused.');
    expect(out).toMatch(/general-purpose\s+│ built-in\s+│\s+2 │\s+1 │\s+4 │\s+\$4\.00 │ m/);
  });

  it('marks share-based costs when prices are unavailable', async () => {
    const out = await run(['agents', '--by', 'session'], true);
    expect(out).toContain('Could not load model prices (offline)');
    expect(out).toMatch(
      /expensiv\s+│ Workspace-site\s+│\s+1 │ general-purpose\s+│\s+4 │\s+11% │\s+\$1\.00\* │/,
    );
  });

  it('lists unused agents, and prints JSON', async () => {
    expect(await run(['agents', '--unused'])).toMatch(
      /kit:hunter\s+│ kit\s+│ haiku\s+│ Finds bugs/,
    );
    const json = JSON.parse(await run(['--json', 'agents', '--since', '2026-11-01'])) as {
      byType: unknown[];
      since: string;
    };
    expect(json.byType).toHaveLength(1);
    expect(json.since).toBe(new Date(2026, 10, 1).toISOString());
  });

  it('feeds review: installed agents and runs reach the agent rules', async () => {
    const out = await run(['review']);
    expect(out).toContain('1 installed agents unused in 30 days');
    expect(out).toContain('9 rules checked');
  });
});

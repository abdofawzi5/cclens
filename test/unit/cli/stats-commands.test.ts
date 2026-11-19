import { stripVTControlCharacters as strip } from 'node:util';
import { describe, expect, it } from 'vitest';
import { resolvePaths } from '../../../src/adapters/system/paths.js';
import { createContainer } from '../../../src/composition-root.js';
import { parseDateOption, parsePositiveInt } from '../../../src/interfaces/cli/dates.js';
import { buildProgram } from '../../../src/interfaces/cli/program.js';
import { compact, shortProject, truncate, usd } from '../../../src/interfaces/render/format.js';
import { event, MemoryEventStore } from '../../support/fakes.js';
import { FakeTokens } from '../../support/fake-tokens.js';
import { InMemoryConfigStore } from '../../support/in-memory-config-store.js';

async function run(args: string[]): Promise<string> {
  const store = new MemoryEventStore();
  store.events.push(
    event('marketing:seo-audit', '2026-11-18T10:00:00Z', { project: 'site' }),
    event('marketing:seo-audit', '2026-11-19T10:00:00Z', { project: 'site', source: 'auto' }),
    event('write-article', '2026-11-19T11:00:00Z', { project: 'blog', source: 'typed' }),
  );
  const container = createContainer({
    overrides: {
      paths: resolvePaths({}, '/Users/me'),
      configStore: new InMemoryConfigStore(),
      eventStore: store,
      tokens: new FakeTokens(),
      skillSource: {
        id: 'fake',
        list: () =>
          Promise.resolve([
            {
              id: 'marketing:seo-audit',
              name: 'seo-audit',
              scope: 'plugin',
              plugin: 'marketing',
              description: 'Audit',
            },
            { id: 'marketing:email', name: 'email', scope: 'plugin', plugin: 'marketing' },
            { id: 'write-article', name: 'write-article', scope: 'personal' },
          ]),
      },
    },
  });
  const lines: string[] = [];
  await buildProgram(container, '1.0.0', (t) => lines.push(t))
    .exitOverride()
    .parseAsync(['node', 'cclens', ...args]);
  return strip(lines.join('\n'));
}

describe('skills command', () => {
  it('lists skills with uses and a summary', async () => {
    const out = await run(['skills']);
    expect(out).toContain('3 installed skills');
    expect(out).toMatch(/marketing:seo-audit\s+│\s+marketing\s+│\s+2\s+│\s+Audit/);
  });

  it('supports --unused, --by-plugin and --json', async () => {
    expect(await run(['skills', '--unused'])).toContain('marketing:email');
    expect(await run(['skills', '--unused'])).not.toContain('seo-audit │');
    expect(await run(['skills', '--by-plugin'])).toMatch(/marketing\s+│\s+2\s+│\s+2/);
    const json = JSON.parse(await run(['--json', 'skills', '--scope', 'personal'])) as {
      skills: unknown[];
    };
    expect(json.skills).toHaveLength(1);
  });
});

describe('usage command', () => {
  it('groups by skill, day and project', async () => {
    expect(await run(['usage'])).toMatch(/marketing:seo-audit\s+│\s+2/);
    expect(await run(['usage'])).toContain('3 skill uses in total');
    const byDay = await run(['usage', '--by', 'day']);
    expect(byDay.indexOf('2026-11-18')).toBeLessThan(byDay.indexOf('2026-11-19'));
    const json = JSON.parse(await run(['--json', 'usage', '--by', 'project', '--limit', '1'])) as {
      total: number;
      rows: { key: string }[];
    };
    expect(json).toMatchObject({ total: 3, rows: [{ key: 'site', uses: 2 }] });
  });
});

describe('tokens command', () => {
  it.each([
    [['tokens'], /2026-11-19.*\$2\.00/],
    [['tokens', 'session', '--limit', '1'], /expensive|Workspace-site/],
    [['tokens', 'project'], /Workspace-site/],
    [['tokens', 'blocks'], /\(now\)/],
    [['tokens', 'weekly'], /p2/],
  ])('%j renders', async (args, pattern) => {
    expect(await run(args)).toMatch(pattern);
  });

  it('prints totals and JSON', async () => {
    expect(await run(['tokens'])).toContain('Total 12 tokens · $3.00');
    const json = JSON.parse(await run(['--json', 'tokens', 'monthly'])) as { view: string };
    expect(json.view).toBe('monthly');
  });
});

describe('cli helpers', () => {
  const now = new Date(2026, 10, 19, 15, 30);
  it.each([
    ['7d', new Date(2026, 10, 12)],
    ['2w', new Date(2026, 10, 5)],
    ['1m', new Date(2026, 9, 19)],
    ['2026-11-01', new Date(2026, 10, 1)],
    ['20261101', new Date(2026, 10, 1)],
  ])('parses %s', (value, expected) => {
    expect(parseDateOption(value, now)).toEqual(expected);
  });

  it.each(['yesterday', '2026-02-30', '7x'])('rejects %s', (value) => {
    expect(() => parseDateOption(value, now)).toThrow(/YYYY-MM-DD/);
  });

  it('parses positive ints', () => {
    expect(parsePositiveInt('3')).toBe(3);
    expect(() => parsePositiveInt('0')).toThrow();
    expect(() => parsePositiveInt('1.5')).toThrow();
  });

  it('formats numbers, money, projects and text', () => {
    expect([compact(950), compact(1234), compact(2_500_000), compact(3.2e9)]).toEqual([
      '950',
      '1.2K',
      '2.5M',
      '3.2B',
    ]);
    expect(usd(3.456)).toBe('$3.46');
    expect(shortProject('-Users-me-Workspace-site', '/Users/me')).toBe('Workspace-site');
    expect(shortProject('-opt-x', '/Users/me')).toBe('opt-x');
    expect(shortProject('-opt-x')).toBe('opt-x');
    expect(truncate('abcdef', 4)).toBe('abc…');
    expect(truncate('abc', 4)).toBe('abc');
  });
});

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CcusageTokenProvider } from '../../src/adapters/tokens/ccusage-token-provider.js';
import { IntegrationError } from '../../src/core/errors.js';
import type { ProcessResult, ProcessRunner } from '../../src/core/ports/infrastructure.js';

const fixture = (name: string): string =>
  readFileSync(join(import.meta.dirname, '..', 'fixtures', 'ccusage', name), 'utf8');

/** Fake runner returning recorded ccusage output and remembering the args it got. */
class FakeRunner implements ProcessRunner {
  calls: string[][] = [];
  constructor(private readonly respond: (args: readonly string[]) => ProcessResult) {}
  run(command: string, args: readonly string[]): Promise<ProcessResult> {
    this.calls.push([command, ...args]);
    return Promise.resolve(this.respond(args));
  }
}

const ok = (stdout: string): ProcessResult => ({ exitCode: 0, stdout, stderr: '' });

function provider(respond: (args: readonly string[]) => ProcessResult): {
  p: CcusageTokenProvider;
  runner: FakeRunner;
} {
  const runner = new FakeRunner(respond);
  return { p: new CcusageTokenProvider(runner, { command: ['node', '/cc/cli.js'] }), runner };
}

describe('CcusageTokenProvider (contract, recorded ccusage 20.0.51 output)', () => {
  it('maps daily buckets and passes filters as ccusage flags', async () => {
    const { p, runner } = provider(() => ok(fixture('daily.json')));
    const rows = await p.byPeriod('day', {
      since: new Date(2026, 10, 18),
      until: new Date(2026, 10, 19),
      project: 'site',
    });
    expect(runner.calls[0]).toEqual([
      'node',
      '/cc/cli.js',
      'claude',
      'daily',
      '--json',
      '--offline',
      '--since',
      '20261118',
      '--until',
      '20261119',
      '--project',
      'site',
    ]);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ period: '2026-11-18', models: ['claude-opus-5-5'] });
    expect(rows[0]?.counts.cacheRead).toBeGreaterThan(0);
    expect(rows[0]?.costUsd).toBeGreaterThan(0);
  });

  it('maps weekly and monthly reports', async () => {
    const row = {
      inputTokens: 1,
      outputTokens: 2,
      cacheCreationTokens: 3,
      cacheReadTokens: 4,
      totalCost: 5,
      modelsUsed: [],
    };
    const { p } = provider((args) =>
      ok(
        args.includes('weekly')
          ? JSON.stringify({ weekly: [{ week: '2026-11-08', ...row }] })
          : JSON.stringify({ monthly: [{ month: '2026-11', ...row }] }),
      ),
    );
    expect((await p.byPeriod('week'))[0]).toEqual({
      period: '2026-11-08',
      counts: { input: 1, output: 2, cacheCreation: 3, cacheRead: 4 },
      costUsd: 5,
      models: [],
    });
    expect((await p.byPeriod('month'))[0]?.period).toBe('2026-11');
  });

  it('maps sessions and blocks', async () => {
    const { p } = provider((args) =>
      ok(fixture(args.includes('session') ? 'session.json' : 'blocks.json')),
    );
    const sessions = await p.bySession();
    expect(sessions.map((s) => s.sessionId)).toEqual(['sess-a', 'sess-b']);
    expect(sessions[0]?.firstActivity).toBeInstanceOf(Date);
    const blocks = await p.blocks();
    expect(blocks.length).toBeGreaterThan(0);
    expect(blocks.at(-1)).toMatchObject({ isActive: true });
    expect(blocks.at(-1)?.tokensPerMinute).toBeGreaterThan(0);
  });

  it('sums per-project days from --instances output', async () => {
    const day = (cost: number) => ({
      inputTokens: 1,
      outputTokens: 1,
      cacheCreationTokens: 1,
      cacheReadTokens: 1,
      totalCost: cost,
      modelsUsed: [],
    });
    const { p, runner } = provider(() =>
      ok(JSON.stringify({ projects: { '-a': [day(1), day(2)], '-b': [day(10)] } })),
    );
    const rows = await p.byProject();
    expect(runner.calls[0]).toContain('--instances');
    expect(rows.map((r) => [r.project, r.costUsd, r.counts.input])).toEqual([
      ['-b', 10, 1],
      ['-a', 3, 2],
    ]);
  });

  it('treats a report without rows as empty', async () => {
    const { p } = provider(() => ok(JSON.stringify({ totals: {} })));
    expect(await p.blocks()).toEqual([]);
    expect(await p.byProject()).toEqual([]);
  });

  it.each([
    [{ exitCode: 2, stdout: '', stderr: 'boom' }, /failed: boom/],
    [{ exitCode: 1, stdout: '', stderr: '' }, /failed: exit 1/],
    [ok('not json'), /did not return JSON/],
    [ok(JSON.stringify({ daily: [{ date: 1 }] })), /may have changed format/],
    [ok('null'), /may have changed format/],
  ])('raises IntegrationError (%#)', async (result, message) => {
    const { p } = provider(() => result);
    const error = await p.byPeriod('day').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(IntegrationError);
    expect((error as Error).message).toMatch(message);
  });
});

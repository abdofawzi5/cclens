import { stripVTControlCharacters as strip } from 'node:util';
import { describe, expect, it } from 'vitest';
import { resolvePaths } from '../../../src/adapters/system/paths.js';
import { createContainer } from '../../../src/composition-root.js';
import type { Job } from '../../../src/core/domain/jobs.js';
import { buildProgram } from '../../../src/interfaces/cli/program.js';
import { every, findJob, monthly } from '../../../src/interfaces/cli/commands/jobs-command.js';
import { FixedClock, MemoryEventStore } from '../../support/fakes.js';
import { FakeTokens } from '../../support/fake-tokens.js';
import { InMemoryConfigStore } from '../../support/in-memory-config-store.js';
import { activity } from '../../support/review.js';

const start = (day: number) => new Date(Date.UTC(2026, 10, day, 5));

async function run(args: string[]): Promise<string> {
  const container = createContainer({
    overrides: {
      paths: resolvePaths({}, '/Users/me'),
      clock: new FixedClock(new Date('2026-11-19T12:00:00Z')),
      configStore: new InMemoryConfigStore(),
      eventStore: new MemoryEventStore(),
      tokens: new FakeTokens(),
      skillSource: { id: 'fake', list: () => Promise.resolve([]) },
      activitySource: {
        read: () =>
          Promise.resolve([
            activity('cheap', { scheduledTask: 'nightly-digest', firstActivity: start(18) }),
            activity('expensive', { scheduledTask: 'nightly-digest', firstActivity: start(19) }),
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

describe('jobs command', () => {
  it('lists jobs with runs, cost per run, interval and monthly cost', async () => {
    const out = await run(['jobs']);
    expect(out).toContain('1 recurring jobs, 2 runs, $10.00 since 2026-10-20');
    expect(out).toMatch(
      /nightly-digest\s+│ scheduled │ Workspace-site\s+│\s+2 │\s+\$5\.00 │\s+1d │ \$10\.00 │ \$150\.00 │ 2026-11-19/,
    );
  });

  it('lists the runs of one job, and prints JSON', async () => {
    const out = await run(['jobs', '--job', 'NIGHTLY']);
    expect(out).toContain(
      'nightly-digest (scheduled): 2 runs, $5.00 per run, every 1d, $150.00 a month',
    );
    expect(out).toMatch(/expensiv\s+│\s+36 │ \$9\.00/);
    const json = JSON.parse(await run(['--json', 'jobs'])) as { jobs: { key: string }[] };
    expect(json.jobs[0]?.key).toBe('scheduled:nightly-digest');
    await expect(run(['jobs', '--job', 'nope'])).rejects.toThrow('No job matches "nope"');
  });

  it('feeds the recurring-cost rule in review', async () => {
    const out = await run(['review']);
    expect(out).toContain('1 recurring job cost ~$150.00 a month');
  });
});

describe('job helpers', () => {
  const job = (name: string, p: Partial<Job> = {}): Job => ({
    key: `scheduled:${name}`,
    name,
    kind: 'scheduled',
    project: '-p',
    runs: [],
    tokens: 0,
    costUsd: 0,
    avgCostUsd: 0,
    firstRun: start(1),
    lastRun: start(2),
    active: true,
    ...p,
  });

  it('formats the interval and monthly cost', () => {
    expect(every(undefined)).toBe('-');
    expect(every(0.25)).toBe('6h');
    expect(every(0.98)).toBe('1d');
    expect(every(3.5)).toBe('3.5d');
    expect(monthly(job('a', { active: false, monthlyCostUsd: 0 }))).toBe('stopped');
    expect(monthly(job('a'))).toBe('one run');
    expect(monthly(job('a', { monthlyCostUsd: 12 }))).toBe('$12.00');
  });

  it('finds a job by exact name first, else a unique part', () => {
    const jobs = [job('daily'), job('daily-extra'), job('weekly')];
    expect(findJob(jobs, 'daily').name).toBe('daily');
    expect(findJob(jobs, 'week').name).toBe('weekly');
    expect(() => findJob(jobs, 'ly')).toThrow('"ly" matches 3 jobs: daily, daily-extra, weekly');
  });
});

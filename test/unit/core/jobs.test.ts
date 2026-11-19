import { describe, expect, it } from 'vitest';
import { groupJobs, normalizeTitle } from '../../../src/core/domain/jobs.js';
import type { SessionActivity } from '../../../src/core/domain/review.js';
import { RecurringCostRule } from '../../../src/core/rules/recurring-cost.js';
import { activity, reviewContext, session } from '../../support/review.js';

const NOW = new Date('2026-11-19T12:00:00Z');
const SINCE = new Date('2026-10-21T00:00:00Z');

/** A run starting on 2026-11-`day` at `hour` UTC. */
function run(id: string, day: number, p: Partial<SessionActivity> = {}, hour = 5): SessionActivity {
  const start = new Date(Date.UTC(2026, 10, day, hour));
  return activity(id, {
    firstActivity: start,
    lastActivity: new Date(start.getTime() + 600_000),
    ...p,
  });
}
const cost = (id: string, usd: number) => ({ ...session(id, { input: 1000 }), costUsd: usd });

describe('normalizeTitle', () => {
  it('drops dates, numbers, quoted names and punctuation', () => {
    expect(normalizeTitle('Daily report 2026-11-19')).toBe('daily report');
    expect(normalizeTitle('Episode 12: "The Moon" — publish!')).toBe('episode publish');
    expect(normalizeTitle('Episode 13: “Stars” — publish')).toBe('episode publish');
    expect(normalizeTitle('123')).toBe('');
  });
});

describe('groupJobs', () => {
  const daily = (id: string, day: number) =>
    run(id, day, { scheduledTask: 'bedtime', title: { text: `Bedtime ${day}`, source: 'custom' } });

  it('groups scheduled runs by task, with a cadence-based monthly cost', () => {
    const jobs = groupJobs(
      [
        daily('a', 16),
        daily('b', 17),
        daily('c', 18),
        daily('d', 19),
        run('extra', 19, { scheduledTask: 'bedtime' }, 9),
      ],
      [cost('a', 4), cost('b', 5), cost('c', 6), cost('d', 5), cost('extra', 5)],
      { since: SINCE, now: NOW },
    );
    expect(jobs).toHaveLength(1);
    const [job] = jobs;
    expect(job).toMatchObject({
      key: 'scheduled:bedtime',
      name: 'bedtime',
      kind: 'scheduled',
      active: true,
    });
    expect(job?.runs.map((r) => r.sessionId)).toEqual(['a', 'b', 'c', 'd', 'extra']);
    expect(job?.costUsd).toBe(25);
    expect(job?.avgCostUsd).toBe(5);
    // Median gap is one day despite the extra run four hours later.
    expect(job?.intervalDays).toBe(1);
    expect(job?.monthlyCostUsd).toBeCloseTo(150);
    expect(job?.runs[0]?.label).toBe('Bedtime 16 (a)');
  });

  it('marks a job stopped when it is well overdue, and gives one run no rate', () => {
    const jobs = groupJobs(
      [
        run('old1', 10, { scheduledTask: 'gone' }),
        run('old2', 11, { scheduledTask: 'gone' }),
        run('once', 18, { scheduledTask: 'post' }),
      ],
      [cost('old1', 3), cost('old2', 3), cost('once', 1)],
      { since: SINCE, now: NOW },
    );
    const gone = jobs.find((j) => j.name === 'gone');
    expect(gone).toMatchObject({ active: false, monthlyCostUsd: 0, intervalDays: 1 });
    const once = jobs.find((j) => j.name === 'post');
    expect(once?.active).toBe(true);
    expect(once?.monthlyCostUsd).toBeUndefined();
    expect(once?.intervalDays).toBeUndefined();
  });

  it('groups hand-run sessions by normalized title per project, from three runs', () => {
    const t = (text: string) => ({ title: { text, source: 'first-prompt' as const } });
    const jobs = groupJobs(
      [
        run('r1', 15, t('Write post 1')),
        run('r2', 17, t('Write post 2')),
        run('r3', 19, t('write post #3')),
        run('other-project', 19, { ...t('Write post 4'), project: '-other' }),
        run('pair1', 18, t('Fix bug')),
        run('pair2', 19, t('Fix bug')),
        run('untitled', 19),
      ],
      [cost('r1', 2), cost('r2', 2), cost('r3', 2)],
      { since: new Date('2026-11-15T00:00:00Z'), now: NOW },
    );
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({
      kind: 'repeated',
      name: 'write post #3',
      key: 'repeated:-Users-me-Workspace-site:write post',
    });
    // $6 over the 5 days since the first run, spread to 30 days.
    expect(jobs[0]?.monthlyCostUsd).toBeCloseTo(36);
    expect(
      groupJobs([run('p1', 18, t('Fix bug')), run('p2', 19, t('Fix bug'))], [], {
        since: SINCE,
        now: NOW,
        minRepeats: 2,
      }),
    ).toHaveLength(1);
  });
});

describe('RecurringCostRule', () => {
  const daily = (task: string, id: string, day: number) => run(id, day, { scheduledTask: task });

  it('points at active jobs above the monthly threshold, costliest first', () => {
    const ctx = reviewContext({
      now: NOW,
      since: SINCE,
      activity: [
        daily('big', 'b1', 18),
        daily('big', 'b2', 19),
        daily('small', 's1', 18),
        daily('small', 's2', 19),
        daily('gone', 'g1', 1),
        daily('gone', 'g2', 2),
      ],
      sessions: [
        cost('b1', 5),
        cost('b2', 5),
        cost('s1', 0.1),
        cost('s2', 0.1),
        cost('g1', 50),
        cost('g2', 50),
      ],
    });
    const [f] = new RecurringCostRule().evaluate(ctx);
    expect(f?.title).toBe('1 recurring job cost ~$150.00 a month');
    expect(f?.severity).toBe('warn');
    expect(f?.detail).toContain('big (scheduled: 2 runs, $5.00 per run, ~$150.00 a month)');
    expect(f?.detail).toContain('Saving 30% per run on big alone would save about $45.00 a month.');
    expect(f?.actions).toContain('Edit the task: ~/.claude/scheduled-tasks/big/SKILL.md');
    expect(new RecurringCostRule({ warnMonthlyUsd: 1000 }).evaluate(ctx)[0]?.severity).toBe('info');
    expect(new RecurringCostRule().evaluate(reviewContext())).toEqual([]);
  });
});

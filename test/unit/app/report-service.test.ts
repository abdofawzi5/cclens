import { describe, expect, it } from 'vitest';
import { buildUsageReport, ReportService } from '../../../src/app/report-service.js';
import type { ReviewReport } from '../../../src/core/domain/review.js';
import { activity, day, reviewContext, session } from '../../support/review.js';

const ctx = reviewContext({
  now: new Date(2026, 10, 19, 12),
  since: new Date(2026, 10, 15),
  windowDays: 5,
  installedSkills: [
    { id: 'mkt:seo', name: 'seo', scope: 'plugin', plugin: 'mkt', description: 'x'.repeat(80) },
    { id: 'mkt:ads', name: 'ads', scope: 'plugin', plugin: 'mkt', description: 'y'.repeat(80) },
    { id: 'eng:debug', name: 'debug', scope: 'plugin', plugin: 'eng', description: 'short' },
    { id: 'write', name: 'write', scope: 'personal', description: 'z'.repeat(20) },
  ],
  skillUseCounts: new Map([['eng:debug', 2]]),
  daily: [
    day('2026-11-16', { input: 100 }, [
      {
        model: 'claude-opus-5-5',
        counts: { input: 80, output: 0, cacheCreation: 0, cacheRead: 0 },
        costUsd: 3,
      },
      {
        model: 'claude-haiku-5-5',
        counts: { input: 20, output: 0, cacheCreation: 0, cacheRead: 0 },
        costUsd: 0.5,
      },
    ]),
    day('2026-11-18', { output: 50 }, [
      {
        model: 'claude-opus-5-5',
        counts: { input: 0, output: 50, cacheCreation: 0, cacheRead: 0 },
        costUsd: 2,
      },
    ]),
  ],
  sessions: [
    { ...session('aaaa1111-cheap', { input: 10 }), costUsd: 1 },
    { ...session('bbbb2222-pricey', { input: 500 }), costUsd: 9 },
    { ...session('cccc3333-middle', { input: 50 }), costUsd: 4 },
  ],
  activity: [
    activity('bbbb2222-pricey', {
      prompts: 12,
      autoCompactions: 2,
      title: { text: 'Website UI review', source: 'custom' },
    }),
  ],
});

const review: ReviewReport = {
  scope: { kind: 'window' },
  since: ctx.since,
  until: ctx.now,
  summary: {
    totalTokens: 150,
    costUsd: 5.5,
    sessions: 3,
    prompts: 12,
    autoCompactions: 2,
    installedSkills: 4,
    usedSkills: 1,
  },
  recommendations: [
    { ruleId: 'unused-skills', severity: 'warn', title: 'Unused', detail: 'd', actions: [] },
  ],
  rulesRun: ['unused-skills'],
  notes: ['Could not load something'],
};

describe('buildUsageReport', () => {
  const report = buildUsageReport({ report: review, context: ctx }, 2);

  it('fills every day of the window, with zeros for quiet days', () => {
    expect(report.daily.map((d) => d.day)).toEqual([
      '2026-11-15',
      '2026-11-16',
      '2026-11-17',
      '2026-11-18',
      '2026-11-19',
    ]);
    expect(report.daily.map((d) => d.tokens)).toEqual([0, 100, 0, 50, 0]);
    expect(report.daily.map((d) => d.costUsd)).toEqual([0, 3.5, 0, 2, 0]);
  });

  it('splits cost by model, costliest first', () => {
    expect(report.models).toEqual([
      { model: 'claude-opus-5-5', tokens: 130, costUsd: 5 },
      { model: 'claude-haiku-5-5', tokens: 20, costUsd: 0.5 },
    ]);
  });

  it('lists the costliest sessions with titles and activity', () => {
    expect(report.topSessions).toHaveLength(2);
    expect(report.topSessions[0]).toMatchObject({
      sessionId: 'bbbb2222-pricey',
      label: 'Website UI review (bbbb2222)',
      costUsd: 9,
      tokens: 500,
      prompts: 12,
      autoCompactions: 2,
    });
    expect(report.topSessions[1]).toMatchObject({ label: 'cccc3333', prompts: 0 });
  });

  it('groups unused skills by plugin, costliest first', () => {
    expect(report.unusedSkills.map((g) => [g.name, g.isPlugin, g.skills])).toEqual([
      ['mkt', true, 2],
      ['write', false, 1],
    ]);
    expect(report.unusedListingTokens).toBe(
      report.unusedSkills.reduce((n, g) => n + g.listingTokens, 0),
    );
  });

  it('carries the summary, findings and notes from the review unchanged', () => {
    expect(report.summary).toBe(review.summary);
    expect(report.findings).toBe(review.recommendations);
    expect(report.notes).toEqual(['Could not load something']);
    expect(report.windowDays).toBe(5);
  });

  it('matches the snapshot', () => {
    expect(JSON.parse(JSON.stringify(report))).toMatchSnapshot();
  });
});

describe('ReportService', () => {
  it('runs one review with the window and builds from it', async () => {
    const calls: unknown[] = [];
    const service = new ReportService({
      analyse: (options) => {
        calls.push(options);
        return Promise.resolve({ report: review, context: ctx });
      },
    });
    const report = await service.build({ windowDays: 5, topSessions: 1 });
    expect(calls).toEqual([{ windowDays: 5 }]);
    expect(report.topSessions).toHaveLength(1);
    expect((await service.build()).topSessions).toHaveLength(3);
  });
});

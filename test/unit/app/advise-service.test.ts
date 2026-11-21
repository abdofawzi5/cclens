import { describe, expect, it } from 'vitest';
import { AdviseService, type AdviseDeps } from '../../../src/app/advise-service.js';
import type { ReviewAnalysis } from '../../../src/app/review-service.js';
import type { SearchResult } from '../../../src/core/domain/search.js';
import { stripVTControlCharacters as strip } from 'node:util';
import { AdviceRenderer } from '../../../src/interfaces/cli/commands/advise-command.js';
import { activity, reviewContext, session } from '../../support/review.js';

const now = new Date('2026-11-19T12:00:00Z');
const runs = ['2026-11-16', '2026-11-17', '2026-11-18', '2026-11-19'].map((d, i) => ({
  a: activity(`run${String(i)}`, {
    scheduledTask: 'daily-seo-report',
    firstActivity: new Date(`${d}T06:00:00Z`),
    lastActivity: new Date(`${d}T06:10:00Z`),
  }),
  s: session(`run${String(i)}`, { input: 100 }),
}));

const analysis: ReviewAnalysis = {
  context: reviewContext({
    now,
    activity: runs.map((r) => r.a),
    sessions: runs.map((r) => r.s),
  }),
  report: {
    scope: { kind: 'window' },
    since: new Date('2026-10-21T00:00:00Z'),
    until: now,
    summary: {
      totalTokens: 400,
      costUsd: 8,
      sessions: 4,
      prompts: 4,
      autoCompactions: 0,
      installedSkills: 2,
      usedSkills: 1,
    },
    recommendations: [
      { ruleId: 'model-mix', severity: 'info', title: 'All Opus', detail: 'd', actions: [] },
    ],
    rulesRun: ['model-mix'],
    notes: [],
  },
};

const result = (name: string, description: string, installed = false): SearchResult => ({
  kind: 'skill',
  engineIds: ['skillsmp'],
  name,
  description,
  url: `https://example.com/${name}`,
  ...(installed ? { installed } : {}),
});

function deps(overrides: Partial<AdviseDeps> = {}): AdviseDeps & { queries: string[] } {
  const queries: string[] = [];
  return {
    queries,
    review: { analyse: () => Promise.resolve(analysis) },
    context: { report: () => Promise.reject(new Error('no transcripts')) },
    inventory: {
      fixHints: () =>
        Promise.resolve([
          {
            kind: 'command',
            group: { plugin: 'mkt', skills: 3, tokens: 400 },
            command: 'claude plugin disable mkt@market',
          },
        ]),
    },
    search: {
      search: (text) => {
        queries.push(text);
        return Promise.resolve({
          query: { text, limit: 10, sort: 'stars' },
          results: [
            result('seo-report', 'Writes an SEO report'),
            result('seo-report-installed', 'SEO report', true),
            result('unrelated', 'Something else'),
          ],
          outcomes: [],
          totalFound: 3,
          filteredOut: 0,
          notes: [],
        });
      },
    },
    budget: {
      show: () => Promise.resolve({ budget: { warnAt: 100 }, statuses: [] }),
    },
    ...overrides,
  };
}

const emptyAdvice = {
  since: now,
  until: now,
  windowDays: 30,
  summary: analysis.report.summary,
  suggestions: [],
  disable: [],
  discover: [],
  budget: [],
  plan: { items: [], monthlyUsd: 0 },
  notes: [],
};

describe('AdviseService', () => {
  it('combines review findings, budget, fix hints and skill suggestions', async () => {
    const d = deps();
    const advice = await new AdviseService(d).advise();
    expect(advice.suggestions.map((s) => s.ruleId)).toEqual(['model-mix', 'budget']);
    expect(advice.disable).toHaveLength(1);
    expect(d.queries).toEqual(['seo report']);
    expect(advice.discover[0]?.results.map((r) => r.name)).toEqual(['seo-report']);
    expect(advice.notes).toEqual(['Could not load context overhead: no transcripts']);

    const text = strip(new AdviceRenderer().render(advice));
    expect(text).toContain('Top 2 ways to save tokens');
    expect(text).toContain('claude plugin disable mkt@market');
    expect(text).toContain('daily-seo-report (scheduled, 4 runs');
    expect(text).toContain('https://example.com/seo-report');
    // No turn data in this fixture: the plan section still prints, pointing at suggestion 1.
    expect(advice.plan.items).toEqual([]);
    expect(text).toContain('Action plan: biggest wins first');
    expect(text).toContain('start with suggestion 1: All Opus');
  });

  it('prints the action plan last, with its steps', () => {
    const advice = {
      ...emptyAdvice,
      plan: {
        monthlyUsd: 40,
        items: [
          {
            kind: 'cheaper-helper' as const,
            title: 'Hand daily-build to a Sonnet helper',
            target: 'daily-build',
            why: 'Most calls run shell commands.',
            steps: ['Add to ~/x/.claude/settings.json:', '  "enabledPlugins": {}'],
            monthlyUsd: 40,
          },
        ],
      },
    };
    const text = strip(new AdviceRenderer().render(advice));
    const plan = text.indexOf('Action plan: biggest wins first (~$40.00 a month in all)');
    expect(plan).toBeGreaterThan(text.indexOf('ways to save tokens'));
    expect(text).toContain('1. Hand daily-build to a Sonnet helper saves ~$40.00 a month');
    expect(text).toContain('→ Add to ~/x/.claude/settings.json:');
    expect(text).toMatch(/\n {8}"enabledPlugins": \{\}/);
  });

  it('skips the registry search with search: false and survives a failing search', async () => {
    const off = deps();
    expect((await new AdviseService(off).advise({ search: false })).discover).toEqual([]);
    expect(off.queries).toEqual([]);

    const failing = deps({ search: { search: () => Promise.reject(new Error('offline')) } });
    const advice = await new AdviseService(failing).advise();
    expect(advice.discover).toEqual([]);
    expect(advice.notes).toContain('Skill search for "seo report" failed: offline');
  });

  it('passes --project to the review and names it in the advice', async () => {
    const asked: (string | undefined)[] = [];
    const d = deps({
      review: {
        analyse: (o) => {
          asked.push(o?.project);
          return Promise.resolve({
            ...analysis,
            report: { ...analysis.report, project: '-Users-me-Workspace-site' },
          });
        },
      },
    });
    const advice = await new AdviseService(d).advise({ project: 'site', search: false });
    expect(asked).toEqual(['site']);
    expect(advice.project).toBe('-Users-me-Workspace-site');
    // Shortened against the real home dir, so only the folder part is fixed.
    expect(strip(new AdviceRenderer().render(advice))).toMatch(/^Advice for \S*Workspace-site, /);
  });
});

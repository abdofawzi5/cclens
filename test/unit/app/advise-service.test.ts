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
});

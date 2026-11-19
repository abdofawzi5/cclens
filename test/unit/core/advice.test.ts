import { describe, expect, it } from 'vitest';
import {
  budgetAdvice,
  jobQuery,
  jobsToSearch,
  matchesQuery,
  overheadAdvice,
  rankSuggestions,
} from '../../../src/core/domain/advice.js';
import type { Job } from '../../../src/core/domain/jobs.js';
import {
  type OverheadSummary,
  type SessionOverhead,
  withUnrecorded,
} from '../../../src/core/domain/overhead.js';
import type { Recommendation } from '../../../src/core/domain/recommendation.js';
import type { ReviewSummary } from '../../../src/core/domain/review.js';

const latest = (p: Partial<SessionOverhead> = {}): SessionOverhead => ({
  sessionId: 's1',
  project: 'p',
  at: new Date('2026-11-19T10:00:00Z'),
  requestTokens: 50_000,
  promptTokens: 10,
  parts: withUnrecorded(50_000, 10, {}),
  toolNames: 0,
  mcpServers: [],
  instructionFiles: [],
  ...p,
});

const summary = (averageTokens: number, s: SessionOverhead): OverheadSummary => ({
  sessions: 1,
  averageTokens,
  parts: [{ part: 'unrecorded', label: 'Tool definitions', tokens: averageTokens, share: 1 }],
  latest: s,
});

const review = (costUsd: number): ReviewSummary => ({
  totalTokens: 1,
  costUsd,
  sessions: 1,
  prompts: 1,
  autoCompactions: 0,
  installedSkills: 0,
  usedSkills: 0,
});

describe('overheadAdvice', () => {
  it('flags MCP servers by their tool-name tokens, biggest first', () => {
    const recs = overheadAdvice(
      summary(
        10_000,
        latest({
          mcpServers: [
            { server: 'plugin_x_gmail', tools: 20, tokens: 800 },
            { server: 'bc949b87-e7c9-41ac-bea3-3e6a4c32e747', tools: 200, tokens: 11_000 },
          ],
        }),
      ),
    );
    const mcp = recs.find((r) => r.ruleId === 'mcp-overhead');
    expect(mcp?.severity).toBe('warn');
    expect(mcp?.estimatedTokenSavings).toBe(11_800);
    expect(mcp?.savingsBasis).toBe('per-request');
    expect(mcp?.detail).toMatch(/claude\.ai connector bc949b87.*plugin x_gmail/);
  });

  it('flags large CLAUDE.md files and a heavy total, and stays quiet otherwise', () => {
    const recs = overheadAdvice(
      summary(
        45_000,
        latest({
          instructionFiles: [
            { path: '/Users/me/.claude/CLAUDE.md', kind: 'User', tokens: 4_000 },
            { path: '/repo/CLAUDE.md', kind: 'Project', tokens: 500 },
          ],
        }),
      ),
    );
    expect(recs.map((r) => r.ruleId)).toEqual(['large-instructions', 'context-overhead']);
    expect(recs[0]?.detail).toContain('~/.claude/CLAUDE.md');
    expect(recs[0]?.estimatedTokenSavings).toBe(2_000);

    expect(overheadAdvice(summary(5_000, latest()))).toEqual([]);
    expect(overheadAdvice({ sessions: 0, averageTokens: 0, parts: [] })).toEqual([]);
  });
});

describe('budgetAdvice', () => {
  it('is high when a limit is passed', () => {
    const [r] = budgetAdvice(
      { monthly: 100, warnAt: 100 },
      [{ limit: 'monthly', spentUsd: 120, limitUsd: 100, fraction: 1.2, over: true }],
      review(50),
      30,
    );
    expect(r?.severity).toBe('high');
  });

  it('suggests a monthly limit at the recent pace when none is set', () => {
    const [r] = budgetAdvice({ warnAt: 100 }, [], review(45), 30);
    expect(r?.actions).toEqual(['cclens budget set --monthly 50']);
    expect(budgetAdvice({ warnAt: 100 }, [], review(0), 30)).toEqual([]);
    expect(budgetAdvice(undefined, [], review(45), 30)).toEqual([]);
  });
});

describe('skill discovery helpers', () => {
  it('turns job names into short search words', () => {
    expect(jobQuery('daily-seo-report-2026-11-19')).toBe('seo report');
    expect(jobQuery('Write the weekly newsletter for my blog')).toBe('write newsletter blog');
    expect(jobQuery('2026-11-19')).toBe('');
  });

  it('keeps results that share most query words', () => {
    expect(
      matchesQuery({ name: 'seo-audit', description: 'Audit a site report' }, 'seo report'),
    ).toBe(true);
    expect(
      matchesQuery({ name: 'giggles', description: 'a UI framework' }, 'giggle grove bedtime'),
    ).toBe(false);
    expect(matchesQuery({ name: 'parody-short' }, 'giggle grove adventures')).toBe(false);
  });

  it('picks active jobs, costliest per month first', () => {
    const job = (name: string, monthly: number, active = true): Job => ({
      key: name,
      name,
      kind: 'scheduled',
      project: 'p',
      runs: [],
      tokens: 0,
      costUsd: 1,
      avgCostUsd: 1,
      firstRun: new Date(),
      lastRun: new Date(),
      active,
      monthlyCostUsd: monthly,
    });
    const picked = jobsToSearch(
      [
        job('cheap report', 5),
        job('stopped report', 900, false),
        job('seo report', 50),
        job('123', 99),
      ],
      5,
    );
    expect(picked.map((j) => j.name)).toEqual(['seo report', 'cheap report']);
  });
});

describe('rankSuggestions', () => {
  it('merges groups, drops duplicates and ranks by severity then saving', () => {
    const r = (
      ruleId: string,
      severity: Recommendation['severity'],
      save?: number,
    ): Recommendation => ({
      ruleId,
      severity,
      title: ruleId,
      detail: '',
      actions: [],
      ...(save ? { estimatedTokenSavings: save } : {}),
    });
    const ranked = rankSuggestions(
      [r('a', 'info'), r('b', 'warn', 10)],
      [r('c', 'warn', 99), r('a', 'info')],
    );
    expect(ranked.map((x) => x.ruleId)).toEqual(['c', 'b', 'a']);
  });
});

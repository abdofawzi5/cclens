import { describe, expect, it } from 'vitest';
import { buildActionPlan, type PlanInput } from '../../../src/core/domain/action-plan.js';
import type { FixHint } from '../../../src/core/domain/fix-hints.js';
import { groupJobs } from '../../../src/core/domain/jobs.js';
import type { OverheadSummary } from '../../../src/core/domain/overhead.js';
import type { SessionActivity, SessionTurns } from '../../../src/core/domain/review.js';
import { activity, session } from '../../support/review.js';

const now = new Date('2026-11-19T12:00:00Z');

const turns = (p: Partial<SessionTurns> = {}): SessionTurns => ({
  modelCalls: 100,
  firstContextTokens: 100_000,
  contextTokens: 15_000_000,
  maxContextTokens: 250_000,
  mainModel: 'claude-opus-5-5',
  toolCalls: 60,
  shellCalls: 50,
  imageReads: 0,
  fileReads: [],
  mcpServersUsed: [],
  ...p,
});

/** Four daily runs of one scheduled task, $5 each. */
function dailyRuns(name: string, t: Partial<SessionTurns> = {}): PlanInput {
  const days = ['2026-11-16', '2026-11-17', '2026-11-18', '2026-11-19'];
  const act: SessionActivity[] = days.map((d, i) =>
    activity(`${name}${String(i)}`, {
      scheduledTask: name,
      cwd: '/Users/me/studio',
      firstActivity: new Date(`${d}T05:00:00Z`),
      lastActivity: new Date(`${d}T06:00:00Z`),
      turns: turns(t),
    }),
  );
  const sessions = act.map((a) => ({
    ...session(a.sessionId, { cacheRead: 15_000_000 }),
    costUsd: 5,
  }));
  return {
    jobs: groupJobs(act, sessions, { since: new Date('2026-10-21T00:00:00Z'), now }),
    activity: act,
    sessions,
    disable: [],
    windowDays: 30,
  };
}

const overhead: OverheadSummary = {
  sessions: 1,
  averageTokens: 100_000,
  parts: [],
  latest: {
    sessionId: 'x',
    project: 'p',
    at: now,
    requestTokens: 100_000,
    promptTokens: 10,
    parts: {
      'system-prompt': 0,
      'tool-names': 0,
      'mcp-instructions': 4_000,
      skills: 0,
      agents: 0,
      instructions: 0,
      session: 0,
      unrecorded: 0,
    },
    toolNames: 300,
    mcpServers: [
      { server: 'vercel', tools: 200, tokens: 30_000 },
      { server: 'kokoro', tools: 3, tokens: 2_000 },
    ],
    instructionFiles: [],
  },
};

const unusedPlugin: FixHint = {
  kind: 'command',
  group: { plugin: 'social', skills: 100, tokens: 6_000 },
  command: 'claude plugin disable social@synced',
};

const withoutTurns = (a: SessionActivity): SessionActivity =>
  Object.fromEntries(
    Object.entries(a).filter(([k]) => k !== 'turns'),
  ) as unknown as SessionActivity;

describe('buildActionPlan', () => {
  it('suggests a Sonnet helper for shell-heavy Opus jobs, with the task and agent paths', () => {
    const plan = buildActionPlan(dailyRuns('daily-build'));
    const item = plan.items.find((i) => i.kind === 'cheaper-helper');
    expect(item?.target).toBe('daily-build');
    // $150 a month × 50% of calls are shell × 50% saving.
    expect(item?.monthlyUsd).toBeCloseTo(37.5, 0);
    expect(item?.steps.join('\n')).toContain('~/studio/.claude/agents/daily-build-runner.md');
    expect(item?.steps.join('\n')).toContain('~/.claude/scheduled-tasks/daily-build/SKILL.md');
  });

  it('leaves out the helper on a cheaper model or with few shell calls', () => {
    expect(
      buildActionPlan(dailyRuns('a', { mainModel: 'claude-sonnet-5-5' })).items.map((i) => i.kind),
    ).not.toContain('cheaper-helper');
    expect(buildActionPlan(dailyRuns('b', { shellCalls: 3 })).items).toEqual([]);
  });

  it('moves image checks to a helper and flags big files read every run', () => {
    const plan = buildActionPlan(
      dailyRuns('daily-video', {
        shellCalls: 0,
        imageReads: 20,
        fileReads: [
          { path: '/Users/me/studio/EPISODE_LOG.md', tokens: 40_000 },
          { path: '/Users/me/studio/small.md', tokens: 500 },
        ],
      }),
    );
    expect(plan.items.map((i) => i.kind).sort()).toEqual(['big-reads', 'images-in-helper']);
    const reads = plan.items.find((i) => i.kind === 'big-reads');
    expect(reads?.why).toContain('EPISODE_LOG.md');
    expect(reads?.why).not.toContain('small.md');
  });

  it('suggests a lean folder setup from unused MCP servers and plugins, keeping used servers', () => {
    const input = dailyRuns('daily-build', { shellCalls: 0, mcpServersUsed: ['kokoro'] });
    const plan = buildActionPlan({ ...input, overhead, disable: [unusedPlugin] });
    const lean = plan.items.find((i) => i.kind === 'lean-setup');
    expect(lean?.target).toBe('~/studio');
    const steps = lean?.steps.join('\n') ?? '';
    expect(steps).toContain('"social@synced": false');
    expect(steps).toContain('"mcp__vercel"');
    expect(steps).not.toContain('mcp__kokoro');
    // 30K vercel + its share of instructions (3.75K) + 6K skills ≈ 39.75K of every call.
    expect(lean?.monthlyUsd).toBeGreaterThan(5);
    expect(plan.monthlyUsd).toBeCloseTo(
      plan.items.reduce((n, i) => n + i.monthlyUsd, 0),
      5,
    );
  });

  it('is empty without turn data and caps and orders the items', () => {
    const input = dailyRuns('x');
    expect(
      buildActionPlan({
        ...input,
        activity: input.activity.map(withoutTurns),
      }).items,
    ).toEqual([]);
    const big = buildActionPlan(
      { ...dailyRuns('y', { imageReads: 20 }), overhead, disable: [unusedPlugin] },
      { maxItems: 2 },
    );
    expect(big.items).toHaveLength(2);
    const [first, second] = big.items.map((i) => i.monthlyUsd);
    expect(first).toBeGreaterThanOrEqual(second ?? 0);
  });
});

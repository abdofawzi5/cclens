import { describe, expect, it } from 'vitest';
import { AgentService, runCost } from '../../../src/app/agent-service.js';
import type { Agent, AgentRun, ModelPrice } from '../../../src/core/domain/agent.js';
import { costOf } from '../../../src/core/domain/agent.js';
import type { PriceTable } from '../../../src/core/ports/agents.js';
import { ExpensiveAgentsRule, UnusedAgentsRule } from '../../../src/core/rules/agents.js';
import { FakeTokens } from '../../support/fake-tokens.js';
import { activity, counts, reviewContext, session } from '../../support/review.js';

const OPUS: ModelPrice = { input: 5e-6, output: 25e-6, cacheCreation: 6e-6, cacheRead: 5e-7 };
const prices: PriceTable = { price: (m) => (m === 'claude-opus-5-5' ? OPUS : undefined) };

function run(id: string, type: string, sessionId: string, model: string, input: number): AgentRun {
  const c = counts({ input });
  return {
    sessionId,
    project: '-Users-me-Workspace-site',
    agentId: id,
    agentType: type,
    start: new Date('2026-11-19T08:00:00Z'),
    end: new Date('2026-11-19T08:10:00Z'),
    counts: c,
    byModel: [{ model, counts: c }],
  };
}

const agent = (id: string, p: Partial<Agent> = {}): Agent => ({
  id,
  name: id.split(':').pop() ?? id,
  scope: id.includes(':') ? 'plugin' : 'personal',
  ...(id.includes(':') ? { plugin: id.split(':')[0] } : {}),
  description: 'Does a thing '.repeat(10),
  ...p,
});

describe('runCost', () => {
  const s = { ...session('s1', { input: 1000 }), costUsd: 10 };

  it('prices each model and gives the share of the session', () => {
    const c = runCost(run('a', 't', 's1', 'claude-opus-5-5', 250), s, prices);
    expect(c.pricedUsd).toBeCloseTo(250 * 5e-6);
    expect(c.share).toBe(0.25);
    expect(c.shareUsd).toBe(2.5);
  });

  it('has no priced figure when a model is unknown or prices are missing', () => {
    expect(runCost(run('a', 't', 's1', 'mystery', 100), s, prices).pricedUsd).toBeUndefined();
    expect(runCost(run('a', 't', 's1', 'claude-opus-5-5', 100), s).pricedUsd).toBeUndefined();
    expect(runCost(run('a', 't', 'other', 'claude-opus-5-5', 100), undefined, prices)).toEqual({
      pricedUsd: 100 * 5e-6,
      shareUsd: 0,
    });
  });

  it('costOf weighs every token kind', () => {
    expect(costOf({ input: 1, output: 1, cacheCreation: 1, cacheRead: 1 }, OPUS)).toBeCloseTo(
      5e-6 + 25e-6 + 6e-6 + 5e-7,
    );
  });
});

describe('AgentService', () => {
  const runs = [
    run('a1', 'toolkit:hunter', 'expensive', 'claude-opus-5-5', 2),
    run('a2', 'toolkit:hunter', 'cheap', 'mystery', 1),
    run('a3', 'general-purpose', 'expensive', 'claude-opus-5-5', 4),
  ];

  function service(loadPrices: () => Promise<PriceTable> = () => Promise.resolve(prices)) {
    return new AgentService({
      agents: {
        id: 'fake',
        list: () =>
          Promise.resolve([
            agent('toolkit:hunter'),
            agent('toolkit:idle'),
            agent('mine'),
            agent('Explore'),
          ]),
      },
      activity: {
        read: () =>
          Promise.resolve({
            runs,
            calls: new Map([
              ['toolkit:hunter', 3],
              ['general-purpose', 1],
              ['ghost', 2],
            ]),
          }),
      },
      tokens: new FakeTokens(),
      prices: { load: loadPrices },
      sessions: {
        read: () =>
          Promise.resolve([
            activity('expensive', { title: { text: 'Big job', source: 'custom' } }),
          ]),
      },
    });
  }

  it('groups by agent type with calls, runs, tokens and cost basis', async () => {
    const r = await service().report({ since: new Date('2026-11-01') });
    const rows = Object.fromEntries(r.byType.map((t) => [t.agentType, t]));
    expect(rows['toolkit:hunter']).toMatchObject({
      calls: 3,
      runs: 2,
      sessions: 2,
      tokens: 3,
      costBasis: 'mixed',
      builtin: false,
      models: ['claude-opus-5-5', 'mystery'],
    });
    expect(rows['toolkit:hunter']?.agent?.plugin).toBe('toolkit');
    expect(rows['general-purpose']).toMatchObject({ builtin: true, costBasis: 'priced', runs: 1 });
    expect(rows['ghost']).toMatchObject({ calls: 2, runs: 0, tokens: 0, costUsd: 0 });
    expect(r.totals).toMatchObject({ calls: 6, runs: 3, tokens: 7 });
    expect(r.installed).toBe(4);
    expect(r.pricesLoaded).toBe(true);
    expect(r.since).toEqual(new Date('2026-11-01'));
  });

  it('lists unused installed agents, never built-ins', async () => {
    const r = await service().report();
    expect(r.unused.map((a) => a.id)).toEqual(['mine', 'toolkit:idle']);
  });

  it('groups by session with titles, costliest first', async () => {
    const r = await service().report();
    expect(r.bySession.map((s) => [s.label, s.runs, s.agentTokens])).toEqual([
      // The unpriced run's share of its session ($1 × 1/4) beats a few priced opus tokens.
      ['cheap', 1, 1],
      ['Big job (expensiv)', 2, 6],
    ]);
    // FakeTokens: the expensive session has 36 tokens and costs $9.
    expect(r.bySession[1]?.sessionTokens).toBe(36);
    expect(r.bySession[0]?.costBasis).toBe('share');
  });

  it('falls back to the share of the session when prices cannot load', async () => {
    const r = await service(() => Promise.reject(new Error('offline'))).report();
    expect(r.pricesLoaded).toBe(false);
    expect(r.notes[0]).toContain('Could not load model prices (offline)');
    const gp = r.byType.find((t) => t.agentType === 'general-purpose');
    expect(gp?.costBasis).toBe('share');
    expect(gp?.costUsd).toBeCloseTo((4 / 36) * 9);
  });
});

describe('agent rules', () => {
  it('unused-agents counts listing tokens of agents never called', () => {
    const ctx = reviewContext({
      installedAgents: [agent('toolkit:a'), agent('toolkit:b'), agent('mine'), agent('Explore')],
      agentCalls: new Map([['toolkit:b', 1]]),
    });
    const [f] = new UnusedAgentsRule().evaluate(ctx);
    expect(f?.title).toBe('2 installed agents unused in 30 days');
    expect(f?.detail).toContain('2 of 4 installed agents');
    expect(f?.detail).toContain('Most come from: toolkit (1), personal (1).');
    expect(f?.severity).toBe('info');
    expect(f?.savingsBasis).toBe('per-request');
    expect(new UnusedAgentsRule({ warnAboveTokens: 1 }).evaluate(ctx)[0]?.severity).toBe('warn');
    expect(new UnusedAgentsRule().evaluate(reviewContext())).toEqual([]);
  });

  it('expensive-agents flags runs with a large share of their session', () => {
    const ctx = reviewContext({
      sessions: [session('s1', { input: 4_000_000 }), session('s2', { input: 100_000_000 })],
      agentRuns: [
        run('a', 'general-purpose', 's1', 'claude-opus-5-5', 2_000_000),
        run('b', 'general-purpose', 's1', 'claude-opus-5-5', 1_000_000),
        run('c', 'toolkit:hunter', 's2', 'claude-haiku-5-5', 2_000_000),
        run('d', 'orphan', 'unknown', 'x', 9_000_000),
      ],
    });
    const [f] = new ExpensiveAgentsRule().evaluate(ctx);
    expect(f?.title).toBe('1 agent run used over 40% of a session’s tokens');
    expect(f?.detail).toContain(
      'general-purpose: 1 run, 2.0M tokens (50% of their sessions) on claude-opus-5-5',
    );
    const loose = new ExpensiveAgentsRule({ minShare: 0.2, minTokens: 1 }).evaluate(ctx)[0];
    expect(loose?.title).toBe('2 agent runs used over 20% of a session’s tokens');
    expect(new ExpensiveAgentsRule().evaluate(reviewContext())).toEqual([]);
  });
});

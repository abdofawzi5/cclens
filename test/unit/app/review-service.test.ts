import { describe, expect, it } from 'vitest';
import { ConfigService } from '../../../src/app/config-service.js';
import { ReviewService, type ReviewDeps } from '../../../src/app/review-service.js';
import { UsageService } from '../../../src/app/usage-service.js';
import type { Recommendation } from '../../../src/core/domain/recommendation.js';
import type { ReviewContext, SessionActivity } from '../../../src/core/domain/review.js';
import type { OptimizationRule } from '../../../src/core/ports/review.js';
import { withUnrecorded } from '../../../src/core/domain/overhead.js';
import { defaultConfig } from '../../../src/core/config/defaults.js';
import { event, FixedClock, MemoryEventStore } from '../../support/fakes.js';
import { FakeTokens } from '../../support/fake-tokens.js';
import { InMemoryConfigStore } from '../../support/in-memory-config-store.js';
import { activity } from '../../support/review.js';

/** Records the context it saw and returns fixed findings. */
class SpyRule implements OptimizationRule {
  seen: ReviewContext[] = [];
  readonly description = 'spy';
  readonly defaultSeverity = 'info' as const;
  constructor(
    readonly id: string,
    readonly appliesTo: readonly ('window' | 'session')[],
    private readonly out: Recommendation[] = [],
  ) {}
  evaluate(ctx: ReviewContext): readonly Recommendation[] {
    this.seen.push(ctx);
    return this.out;
  }
}

const rec = (
  ruleId: string,
  severity: Recommendation['severity'],
  title = ruleId,
): Recommendation => ({
  ruleId,
  severity,
  title,
  detail: '',
  actions: [],
});

function service(over: Partial<ReviewDeps> = {}, disabled: string[] = []) {
  const store = new MemoryEventStore();
  store.events.push(
    event('mkt:seo', '2026-11-15T00:00:00Z'),
    event('mkt:seo', '2026-01-01T00:00:00Z'),
  );
  const config = new InMemoryConfigStore();
  const base = defaultConfig();
  void config.save({ ...base, review: { ...base.review, disabledRules: disabled } });
  const activitySeen: (Date | undefined)[] = [];
  const acts: SessionActivity[] = [
    activity('cheap', { prompts: 4, autoCompactions: 1 }),
    activity('later-1'),
  ];
  const window = new SpyRule(
    'w',
    ['window'],
    [rec('w', 'info', 'tip'), rec('w', 'high', 'urgent')],
  );
  const both = new SpyRule('b', ['window', 'session'], [rec('b', 'warn')]);
  const deps: ReviewDeps = {
    config: new ConfigService(config),
    skills: {
      id: 's',
      list: () => Promise.resolve([{ id: 'mkt:seo', name: 'seo', scope: 'plugin', plugin: 'mkt' }]),
    },
    usage: new UsageService(store, new FixedClock()),
    tokens: new FakeTokens(),
    activity: {
      read: (since?: Date) => {
        activitySeen.push(since);
        return Promise.resolve(acts);
      },
    },
    clock: new FixedClock(new Date(2026, 10, 19, 12)),
    rules: [window, both],
    ...over,
  };
  return { svc: new ReviewService(deps), window, both, activitySeen };
}

describe('ReviewService', () => {
  it('builds a window context, runs window rules and sorts findings', async () => {
    const { svc, window, activitySeen } = service();
    const r = await svc.review({ windowDays: 7 });
    const ctx = window.seen[0];
    expect(ctx?.since).toEqual(new Date(2026, 10, 13));
    expect(activitySeen[0]).toEqual(new Date(2026, 10, 13));
    expect(ctx?.skillUseCounts.get('mkt:seo')).toBe(1);
    expect(ctx?.usageTrackedSince).toEqual(new Date('2026-01-01T00:00:00Z'));
    expect(ctx?.installedSkills).toHaveLength(1);
    expect(r.recommendations.map((x) => x.title)).toEqual(['urgent', 'b', 'tip']);
    expect(r.rulesRun).toEqual(['w', 'b']);
    expect(r.summary).toEqual({
      totalTokens: 12,
      costUsd: 3,
      sessions: 3,
      prompts: 7,
      autoCompactions: 1,
      installedSkills: 1,
      usedSkills: 1,
    });
    expect(r.notes).toEqual([]);
    expect(r).not.toHaveProperty('ai');
  });

  it('uses the configured window and skips disabled rules', async () => {
    const { svc } = service({}, ['w']);
    const r = await svc.review();
    expect(r.since).toEqual(new Date(2026, 9, 21));
    expect(r.rulesRun).toEqual(['b']);
    expect((await svc.rules()).map((x) => [x.id, x.enabled])).toEqual([
      ['w', false],
      ['b', true],
    ]);
  });

  it('runs only the requested rules and rejects unknown ones', async () => {
    const { svc } = service({}, ['w']);
    expect((await svc.review({ only: ['w'] })).rulesRun).toEqual(['w']);
    await expect(svc.review({ only: ['nope'] })).rejects.toThrow(/Unknown rule: nope/);
  });

  it('reviews one session by id prefix with session rules only', async () => {
    const { svc, both, window, activitySeen } = service();
    const r = await svc.review({ sessionId: 'exp' });
    expect(r.scope).toEqual({ kind: 'session', sessionId: 'expensive' });
    expect(window.seen).toHaveLength(0);
    const ctx = both.seen[0];
    expect(ctx?.sessions.map((s) => s.sessionId)).toEqual(['expensive']);
    expect(ctx?.installedSkills).toEqual([]);
    expect(ctx?.daily).toEqual([]);
    expect(activitySeen[0]).toBeUndefined();
    expect(r.summary.totalTokens).toBe(36);
    expect(r.since).toEqual(new Date('2026-11-19T08:00:00Z'));
  });

  it('picks the most recent session with --last', async () => {
    const acts = [activity('newest', { lastActivity: new Date('2026-11-19T11:30:00Z') })];
    const { svc } = service({ activity: { read: () => Promise.resolve(acts) } });
    const r = await svc.review({ last: true });
    expect(r.scope).toEqual({ kind: 'session', sessionId: 'newest' });
    expect(r.since).toBeInstanceOf(Date);
  });

  it('finds a session by title and lists the choices when several match', async () => {
    const acts = [
      activity('expensive', { title: { text: 'Website UI review', source: 'custom' } }),
      activity('cheap', { title: { text: 'Daily episode', source: 'custom' } }),
      activity('later-1', { title: { text: 'Daily episode', source: 'custom' } }),
    ];
    const { svc } = service({ activity: { read: () => Promise.resolve(acts) } });
    const r = await svc.review({ sessionId: 'website' });
    expect(r.scope).toEqual({
      kind: 'session',
      sessionId: 'expensive',
      title: { text: 'Website UI review', source: 'custom' },
    });
    await expect(svc.review({ sessionId: 'daily' })).rejects.toThrow(
      /matches 2 sessions[\s\S]*Daily episode \(cheap\)[\s\S]*Daily episode \(later-1\)/,
    );
  });

  it('explains unknown, ambiguous and missing sessions', async () => {
    const { svc } = service();
    await expect(svc.review({ sessionId: 'zzz' })).rejects.toThrow(/No session matches "zzz"/);
    await expect(svc.review({ sessionId: '' })).rejects.toThrow(/matches 3 sessions/);
    const empty = service({
      activity: { read: () => Promise.resolve([]) },
      tokens: Object.assign(new FakeTokens(), { bySession: () => Promise.resolve([]) }),
    });
    await expect(empty.svc.review({ last: true })).rejects.toThrow(/No sessions found/);
  });

  it('turns failing sources and rules into notes', async () => {
    const boom = (): Promise<never> => Promise.reject(new Error('boom'));
    const failing: OptimizationRule = {
      id: 'bad',
      description: '',
      defaultSeverity: 'info',
      appliesTo: ['window'],
      evaluate: () => {
        throw new Error('rule broke');
      },
    };
    const tokens = Object.assign(new FakeTokens(), { byPeriod: boom, bySession: boom });
    const { svc } = service({
      tokens,
      skills: { id: 's', list: boom },
      activity: { read: boom },
      rules: [failing],
    });
    const r = await svc.review();
    expect(r.notes).toEqual([
      'Could not load installed skills: boom',
      'Could not load daily tokens (ccusage): boom',
      'Could not load session tokens (ccusage): boom',
      'Could not load session activity (transcripts): boom',
      'Rule bad failed: rule broke',
    ]);
    expect(r.summary.totalTokens).toBe(0);
  });

  it('adds AI findings after rule findings and reports AI failures', async () => {
    const good = service({
      ai: { review: () => Promise.resolve([rec('ai', 'info', 'z'), rec('ai', 'high', 'a')]) },
    });
    const r = await good.svc.review({ ai: true });
    expect(r.ai).toEqual({ ok: true, count: 2 });
    expect(r.recommendations.map((x) => x.title).slice(-2)).toEqual(['a', 'z']);

    const bad = service({ ai: { review: () => Promise.reject(new Error('not logged in')) } });
    expect((await bad.svc.review({ ai: true })).ai).toEqual({ ok: false, error: 'not logged in' });

    const none = service();
    expect((await none.svc.review({ ai: true })).ai).toEqual({
      ok: false,
      error: 'No AI reviewer is configured.',
    });
  });

  it('compares the window with the one before it', async () => {
    const { svc } = service();
    const report = await svc.review({ windowDays: 1, compare: true });
    // FakeTokens: 2026-11-18 costs $1 (previous day), 2026-11-19 costs $2 (window).
    expect(report.comparison?.previous).toMatchObject({ costUsd: 1, sessions: 0 });
    expect(report.comparison?.current).toMatchObject({ costUsd: 2, sessions: 2, prompts: 7 });
    expect((await svc.review({ last: true, compare: true })).comparison).toBeUndefined();
  });

  it('uses the latest measured skill listing', async () => {
    const { svc, window } = service({
      overhead: {
        read: () =>
          Promise.resolve([
            {
              sessionId: 'x',
              project: 'p',
              at: new Date('2026-11-19T09:00:00Z'),
              requestTokens: 0,
              promptTokens: 0,
              parts: withUnrecorded(0, 0, {}),
              toolNames: 0,
              mcpServers: [],
              instructionFiles: [],
              skillListing: { 'mkt:seo': 4 },
            },
          ]),
      },
    });
    await svc.review();
    expect(window.seen[0]?.skillListing).toEqual({ 'mkt:seo': 4 });
  });
});

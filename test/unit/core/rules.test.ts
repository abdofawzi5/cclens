import { describe, expect, it } from 'vitest';
import type { Skill } from '../../../src/core/domain/skill.js';
import {
  CacheChurnRule,
  defaultRules,
  FrequentCompactionRule,
  LongSessionsRule,
  ModelMixRule,
  skillListingTokens,
  UnusedSkillsRule,
  UsageSpikesRule,
} from '../../../src/core/rules/index.js';
import { estimateTokens, median } from '../../../src/core/util/estimate-tokens.js';
import { localDay, percent } from '../../../src/core/util/format.js';
import { activity, day, reviewContext, session } from '../../support/review.js';

const skill = (id: string, plugin?: string, description = 'x'.repeat(400)): Skill => ({
  id,
  name: id.split(':').at(-1) ?? id,
  scope: plugin ? 'plugin' : 'personal',
  description,
  ...(plugin ? { plugin } : {}),
});

describe('util', () => {
  it('estimates tokens, medians, percents and local days', () => {
    expect(estimateTokens('abcd'.repeat(10))).toBe(10);
    expect(median([])).toBe(0);
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 3, 2])).toBe(2.5);
    expect(percent(0.456)).toBe('46%');
    expect(localDay(new Date(2026, 0, 5, 23))).toBe('2026-01-05');
  });
});

describe('UnusedSkillsRule', () => {
  const installed = [
    skill('social:a', 'social'),
    skill('social:b', 'social'),
    skill('mkt:seo', 'mkt'),
    skill('mkt:email', 'mkt'),
    skill('write-article'),
  ];

  it('groups unused skills by plugin and estimates listing tokens', () => {
    const [rec, ...rest] = new UnusedSkillsRule().evaluate(
      reviewContext({
        installedSkills: installed,
        skillUseCounts: new Map([['mkt:seo', 2]]),
        usageTrackedSince: new Date('2026-10-01T00:00:00Z'),
      }),
    );
    expect(rest).toHaveLength(0);
    // mkt is partly used, so only social (2 skills) and the standalone skill count.
    expect(rec?.title).toBe('3 installed skills unused in 30 days');
    const expected = ['social:a', 'social:b', 'write-article']
      .map((id) => skillListingTokens(installed.find((s) => s.id === id) as Skill))
      .reduce((a, b) => a + b, 0);
    expect(rec?.estimatedTokenSavings).toBe(expected);
    expect(rec?.savingsBasis).toBe('per-request');
    expect(rec?.detail).toContain('social (2 skills');
    expect(rec?.detail).not.toContain('recorded skill uses only since');
    expect(rec?.severity).toBe('info');
  });

  it('warns when the listing is large and explains short tracking history', () => {
    const rule = new UnusedSkillsRule({ warnAboveTokens: 10 });
    const [rec] = rule.evaluate(
      reviewContext({
        installedSkills: installed,
        usageTrackedSince: new Date('2026-11-16T00:00:00Z'),
      }),
    );
    expect(rec?.severity).toBe('warn');
    expect(rec?.detail).toContain('only since 2026-11-16');
    const [none] = rule.evaluate(reviewContext({ installedSkills: installed }));
    expect(none?.detail).toContain('not recorded any skill use yet');
  });

  it('is silent when everything is used or nothing is installed', () => {
    const used = new Map(installed.map((s) => [s.id, 1]));
    expect(
      new UnusedSkillsRule().evaluate(
        reviewContext({ installedSkills: installed, skillUseCounts: used }),
      ),
    ).toEqual([]);
    expect(new UnusedSkillsRule().evaluate(reviewContext())).toEqual([]);
  });

  it('handles skills without a description', () => {
    expect(skillListingTokens({ id: 'x', name: 'x', scope: 'personal' })).toBeGreaterThan(0);
  });
});

describe('LongSessionsRule', () => {
  it('flags sessions above the cache-read threshold, largest first', () => {
    const [rec] = new LongSessionsRule({ cacheReadThreshold: 100 }).evaluate(
      reviewContext({
        sessions: [
          session('aaaaaaaa-1', { cacheRead: 150, output: 50 }),
          session('bbbbbbbb-2', { cacheRead: 900, output: 100 }),
          session('cccccccc-3', { cacheRead: 10 }),
        ],
      }),
    );
    expect(rec?.title).toBe('2 long sessions re-read over 100 cached tokens');
    expect(rec?.detail).toMatch(
      /cache reads were 88% .*Largest: bbbbbbbb \(900 cache reads\), aaaaaaaa/,
    );
  });

  it('uses singular wording and stays quiet below the threshold', () => {
    const rule = new LongSessionsRule({ cacheReadThreshold: 100 });
    const [rec] = rule.evaluate(reviewContext({ sessions: [session('one', { cacheRead: 100 })] }));
    expect(rec?.title).toMatch(/^1 long session /);
    expect(rec?.detail).toContain('this session');
    expect(rule.evaluate(reviewContext({ sessions: [session('x', { cacheRead: 99 })] }))).toEqual(
      [],
    );
  });
});

describe('FrequentCompactionRule', () => {
  it('flags sessions with repeated auto-compactions', () => {
    const [rec] = new FrequentCompactionRule().evaluate(
      reviewContext({
        activity: [
          activity('aaaaaaaa', { autoCompactions: 2, peakContextTokens: 300_000 }),
          activity('bbbbbbbb', { autoCompactions: 5 }),
          activity('cccccccc', { autoCompactions: 1, manualCompactions: 4 }),
        ],
      }),
    );
    expect(rec?.title).toBe('2 sessions auto-compacted 7 times');
    expect(rec?.detail).toContain('up to 300.0K tokens');
    expect(rec?.detail).toContain('bbbbbbbb (5×), aaaaaaaa (2×)');
  });

  it('omits the peak when unknown and is quiet below the minimum', () => {
    const rule = new FrequentCompactionRule();
    const [rec] = rule.evaluate(
      reviewContext({ activity: [activity('a', { autoCompactions: 3 })] }),
    );
    expect(rec?.title).toMatch(/^1 session /);
    expect(rec?.detail).not.toContain('up to');
    expect(
      rule.evaluate(reviewContext({ activity: [activity('a', { autoCompactions: 1 })] })),
    ).toEqual([]);
  });
});

describe('CacheChurnRule', () => {
  const rule = new CacheChurnRule({ minCachedTokens: 100 });

  it('flags a high share of cache writes across the window', () => {
    const [rec] = rule.evaluate(
      reviewContext({ daily: [day('d1', { cacheCreation: 300, cacheRead: 700 })] }),
    );
    expect(rec?.title).toBe('Cache writes are 30% of cached tokens');
    expect(rec?.estimatedTokenSavings).toBe(200);
    expect(rec?.savingsBasis).toBe('window');
  });

  it('uses the session counts in session scope', () => {
    const ctx = reviewContext({
      scope: { kind: 'session', sessionId: 's' },
      daily: [day('d1', { cacheCreation: 0, cacheRead: 1000 })],
      sessions: [session('s', { cacheCreation: 500, cacheRead: 500 })],
    });
    expect(rule.evaluate(ctx)[0]?.title).toContain('50%');
  });

  it('is quiet for healthy or tiny samples', () => {
    expect(
      rule.evaluate(reviewContext({ daily: [day('d', { cacheCreation: 5, cacheRead: 995 })] })),
    ).toEqual([]);
    expect(
      rule.evaluate(reviewContext({ daily: [day('d', { cacheCreation: 50, cacheRead: 10 })] })),
    ).toEqual([]);
  });
});

describe('ModelMixRule', () => {
  const m = (model: string, costUsd: number) => ({
    model,
    costUsd,
    counts: { input: 0, output: 0, cacheCreation: 0, cacheRead: 0 },
  });

  it('flags when the top tier carries most of the cost', () => {
    const [rec] = new ModelMixRule().evaluate(
      reviewContext({
        daily: [day('d1', {}, [m('claude-opus-5-5', 9), m('claude-sonnet-5-5', 1)])],
      }),
    );
    expect(rec?.title).toBe('90% of estimated cost was on claude-opus-5-5');
  });

  it('is quiet for a balanced mix, small spend or missing breakdowns', () => {
    const rule = new ModelMixRule();
    expect(
      rule.evaluate(reviewContext({ daily: [day('d', {}, [m('opus', 5), m('sonnet', 5)])] })),
    ).toEqual([]);
    expect(rule.evaluate(reviewContext({ daily: [day('d', {}, [m('opus', 1)])] }))).toEqual([]);
    expect(rule.evaluate(reviewContext({ daily: [day('d', {})] }))).toEqual([]);
  });
});

describe('UsageSpikesRule', () => {
  const days = ['01', '02', '03', '04', '05'].map((d) => day(`2026-11-${d}`, { cacheRead: 100 }));

  it('names spike days and the heaviest session behind each', () => {
    const spike = day('2026-11-06', { cacheRead: 500 });
    const [rec] = new UsageSpikesRule().evaluate(
      reviewContext({
        daily: [...days, spike],
        sessions: [
          session('small111', { cacheRead: 10 }, '2026-11-06T12:00:00'),
          session('heavy222', { cacheRead: 400 }, '2026-11-06T13:00:00'),
        ],
      }),
    );
    expect(rec?.title).toBe('1 day used 3× or more of a typical day');
    expect(rec?.detail).toContain('2026-11-06: 500 (5.0× typical, mostly session heavy222)');
    expect(rec?.actions[0]).toBe('cclens tokens session --since 2026-11-06 --until 2026-11-06');
  });

  it('works without a matching session and stays quiet with too few days or no spike', () => {
    const rule = new UsageSpikesRule();
    const [rec] = rule.evaluate(
      reviewContext({ daily: [...days, day('2026-11-07', { cacheRead: 900 })] }),
    );
    expect(rec?.detail).not.toContain('mostly');
    expect(rule.evaluate(reviewContext({ daily: days.slice(0, 4) }))).toEqual([]);
    expect(rule.evaluate(reviewContext({ daily: days }))).toEqual([]);
    expect(
      rule.evaluate(
        reviewContext({
          daily: days.map((d) => ({ ...d, counts: { ...d.counts, cacheRead: 0 } })),
        }),
      ),
    ).toEqual([]);
  });
});

describe('defaultRules', () => {
  it('has unique ids and every rule is quiet on an empty context', () => {
    const rules = defaultRules();
    expect(new Set(rules.map((r) => r.id)).size).toBe(rules.length);
    for (const r of rules) expect(r.evaluate(reviewContext())).toEqual([]);
  });
});

import { describe, expect, it } from 'vitest';
import { addTokens, totalTokens, ZERO_TOKENS } from '../../../src/core/domain/tokens.js';
import {
  compareRecommendations,
  type Recommendation,
} from '../../../src/core/domain/recommendation.js';

describe('token math', () => {
  it('adds and totals counts', () => {
    const a = { input: 1, output: 2, cacheCreation: 3, cacheRead: 4 };
    const sum = addTokens(a, a);
    expect(sum).toEqual({ input: 2, output: 4, cacheCreation: 6, cacheRead: 8 });
    expect(totalTokens(sum)).toBe(20);
    expect(totalTokens(ZERO_TOKENS)).toBe(0);
    expect(Object.isFrozen(ZERO_TOKENS)).toBe(true);
  });
});

describe('compareRecommendations', () => {
  const rec = (severity: Recommendation['severity'], savings?: number): Recommendation => ({
    ruleId: 'r',
    severity,
    title: 't',
    detail: 'd',
    actions: [],
    ...(savings === undefined ? {} : { estimatedTokenSavings: savings }),
  });

  it('orders by severity, then by savings', () => {
    const sorted = [rec('info', 999), rec('warn', 10), rec('high'), rec('warn', 50)].sort(
      compareRecommendations,
    );
    expect(sorted.map((r) => [r.severity, r.estimatedTokenSavings])).toEqual([
      ['high', undefined],
      ['warn', 50],
      ['warn', 10],
      ['info', 999],
    ]);
  });
});

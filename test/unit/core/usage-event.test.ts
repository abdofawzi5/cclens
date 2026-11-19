import { describe, expect, it } from 'vitest';
import { matchesUsageFilter, type UsageEvent } from '../../../src/core/domain/usage-event.js';

const event: UsageEvent = {
  v: 1,
  ts: new Date('2026-11-19T10:00:00Z'),
  source: 'auto',
  skill: 'marketing:seo-audit',
  project: 'website',
};

describe('matchesUsageFilter', () => {
  it('matches an empty filter', () => {
    expect(matchesUsageFilter(event, {})).toBe(true);
  });

  it.each([
    [{ since: new Date('2026-11-20T00:00:00Z') }, false],
    [{ since: new Date('2026-11-19T00:00:00Z') }, true],
    [{ until: new Date('2026-11-18T00:00:00Z') }, false],
    [{ skill: 'other' }, false],
    [{ skill: 'marketing:seo-audit' }, true],
    [{ project: 'other' }, false],
    [{ sources: ['typed'] as const }, false],
    [{ sources: ['auto', 'typed'] as const }, true],
  ])('filter %o -> %s', (filter, expected) => {
    expect(matchesUsageFilter(event, filter)).toBe(expected);
  });
});

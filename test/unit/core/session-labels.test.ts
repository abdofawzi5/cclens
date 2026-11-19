import { describe, expect, it } from 'vitest';
import {
  cleanTitle,
  SessionLabels,
  shortSessionId,
} from '../../../src/core/domain/session-labels.js';
import { FrequentCompactionRule } from '../../../src/core/rules/frequent-compaction.js';
import { LongSessionsRule } from '../../../src/core/rules/long-sessions.js';
import { UsageSpikesRule } from '../../../src/core/rules/usage-spikes.js';
import { activity, day, reviewContext, session } from '../../support/review.js';

const ID_A = 'aaaa1111-0000-0000-0000-000000000000';
const ID_B = 'aaaa2222-0000-0000-0000-000000000000';
const ID_C = 'cccc3333-0000-0000-0000-000000000000';

const labels = SessionLabels.from([
  { sessionId: ID_A, title: { text: 'Website UI review', source: 'custom' } },
  { sessionId: ID_B, title: { text: 'Daily episode: bedtime story', source: 'custom' } },
  { sessionId: ID_C },
]);

describe('session titles', () => {
  it('cleans and shortens titles', () => {
    expect(cleanTitle('  a\n  b\tc ')).toBe('a b c');
    expect(cleanTitle('x'.repeat(70))).toBe(`${'x'.repeat(59)}…`);
    expect(cleanTitle('hello world', 8)).toBe('hello w…');
    expect(shortSessionId(ID_A)).toBe('aaaa1111');
  });

  it('labels sessions as `Title (shortid)`, or the short id alone', () => {
    expect(labels.label(ID_A)).toBe('Website UI review (aaaa1111)');
    expect(labels.label(ID_B, 10)).toBe('Daily epi… (aaaa2222)');
    expect(labels.label(ID_C)).toBe('cccc3333');
    expect(labels.title(ID_C)).toBeUndefined();
  });

  it('resolves by id prefix first, then by part of the title', () => {
    const ids = [ID_A, ID_B, ID_C];
    expect(labels.resolve('cccc', ids)).toEqual({ kind: 'one', sessionId: ID_C });
    expect(labels.resolve('aaaa', ids)).toEqual({ kind: 'many', sessionIds: [ID_A, ID_B] });
    expect(labels.resolve(' website ', ids)).toEqual({ kind: 'one', sessionId: ID_A });
    expect(labels.resolve('EPISODE', ids)).toEqual({ kind: 'one', sessionId: ID_B });
    expect(labels.resolve('nothing like it', ids)).toEqual({ kind: 'none' });
  });
});

describe('rules name sessions by title', () => {
  const titled = activity(ID_A, {
    autoCompactions: 5,
    title: { text: 'Website UI review', source: 'custom' },
  });

  it('long-sessions and frequent-compaction', () => {
    const ctx = reviewContext({
      sessions: [session(ID_A, { cacheRead: 30_000_000 })],
      activity: [titled],
    });
    expect(new LongSessionsRule().evaluate(ctx)[0]?.detail).toContain(
      'Website UI review (aaaa1111)',
    );
    expect(new FrequentCompactionRule().evaluate(ctx)[0]?.detail).toContain(
      'Website UI review (aaaa1111) (5×)',
    );
  });

  it('usage-spikes', () => {
    const days = ['2026-11-15', '2026-11-16', '2026-11-17', '2026-11-18'].map((d) =>
      day(d, { input: 10 }),
    );
    const ctx = reviewContext({
      daily: [...days, day('2026-11-19', { input: 100 })],
      sessions: [session(ID_A, { input: 90 }, '2026-11-19T10:00:00')],
      activity: [titled],
    });
    expect(new UsageSpikesRule().evaluate(ctx)[0]?.detail).toContain(
      'mostly session Website UI review (aaaa1111)',
    );
  });
});

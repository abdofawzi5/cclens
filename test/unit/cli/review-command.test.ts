import { stripVTControlCharacters as strip } from 'node:util';
import { describe, expect, it } from 'vitest';
import { resolvePaths } from '../../../src/adapters/system/paths.js';
import { createContainer } from '../../../src/composition-root.js';
import type { ReviewReport } from '../../../src/core/domain/review.js';
import { buildProgram } from '../../../src/interfaces/cli/program.js';
import { ReviewRenderer, wrap } from '../../../src/interfaces/render/review-renderer.js';
import { FixedClock, MemoryEventStore } from '../../support/fakes.js';
import { FakeTokens } from '../../support/fake-tokens.js';
import { InMemoryConfigStore } from '../../support/in-memory-config-store.js';
import { activity } from '../../support/review.js';

async function run(args: string[]): Promise<string> {
  const container = createContainer({
    overrides: {
      paths: resolvePaths({}, '/Users/me'),
      clock: new FixedClock(new Date(2026, 10, 19, 12)),
      configStore: new InMemoryConfigStore(),
      eventStore: new MemoryEventStore(),
      tokens: new FakeTokens(),
      skillSource: {
        id: 'fake',
        list: () =>
          Promise.resolve([
            {
              id: 'mkt:seo',
              name: 'seo',
              scope: 'plugin',
              plugin: 'mkt',
              description: 'x'.repeat(200),
            },
          ]),
      },
      activitySource: {
        read: () =>
          Promise.resolve([
            activity('expensive', { autoCompactions: 3, peakContextTokens: 400_000 }),
          ]),
      },
      aiReviewer: {
        review: () =>
          Promise.resolve([
            {
              ruleId: 'ai',
              severity: 'info',
              title: 'Try plan mode',
              detail: 'Plan first.',
              actions: [],
            },
          ]),
      },
    },
  });
  const lines: string[] = [];
  await buildProgram(container, '1.0.0', (t) => lines.push(t))
    .exitOverride()
    .parseAsync(['node', 'cclens', ...args]);
  return strip(lines.join('\n'));
}

describe('review command', () => {
  it('prints a summary and findings with actions', async () => {
    const out = await run(['review']);
    expect(out).toContain('Review of 2026-10-21 to 2026-11-19');
    expect(out).toContain('2 sessions · 3 prompts · 3 auto-compactions · 0 of 1 skills used');
    expect(out).toMatch(/WARN 1 session auto-compacted 3 times/);
    expect(out).toMatch(/WARN 1 installed skills unused in 30 days|INFO 1 installed skills unused/);
    expect(out).toContain('saves up to ~');
    expect(out).toContain('→ Split long work into one session per task');
    expect(out).toContain('9 rules checked · add --ai');
  });

  it('reviews one session and adds AI suggestions', async () => {
    const out = await run(['review', '--session', 'exp', '--ai']);
    expect(out).toContain('Review of session expensive');
    expect(out).toContain('1 session · 3 prompts · 3 auto-compactions');
    expect(out).not.toContain('skills used');
    expect(out).toContain('INFO (AI) Try plan mode');
    expect(out).toContain('AI review added 1 suggestion');
  });

  it('lists rules and supports --json and --rule', async () => {
    expect(await run(['review', '--list-rules'])).toMatch(/on\s+unused-skills/);
    const json = JSON.parse(
      await run(['--json', 'review', '--rule', 'model-mix', '--days', '7']),
    ) as {
      rulesRun: string[];
      recommendations: unknown[];
    };
    expect(json.rulesRun).toEqual(['model-mix']);
    expect(json.recommendations).toEqual([]);
  });
});

describe('ReviewRenderer', () => {
  const report = (over: Partial<ReviewReport>): ReviewReport => ({
    scope: { kind: 'window' },
    since: new Date(2026, 10, 1),
    until: new Date(2026, 10, 19),
    summary: {
      totalTokens: 0,
      costUsd: 0,
      sessions: 1,
      prompts: 0,
      autoCompactions: 1,
      installedSkills: 0,
      usedSkills: 0,
    },
    recommendations: [],
    rulesRun: [],
    notes: [],
    ...over,
  });

  it('says when nothing was found and shows notes, AI failures and window savings', () => {
    const quiet = strip(
      new ReviewRenderer().render(
        report({ notes: ['Could not load x'], ai: { ok: false, error: 'nope' } }),
      ),
    );
    expect(quiet).toContain('Nothing to improve');
    expect(quiet).toContain('1 session · 0 prompts · 1 auto-compaction ·');
    expect(quiet).toContain('AI review failed: nope');
    expect(quiet).toContain('! Could not load x');

    const withSavings = strip(
      new ReviewRenderer().render(
        report({
          recommendations: [
            {
              ruleId: 'cache-churn',
              severity: 'high',
              title: 'T',
              detail: 'D',
              estimatedTokenSavings: 2000,
              savingsBasis: 'window',
              actions: [],
            },
          ],
          ai: { ok: true, count: 2 },
        }),
      ),
    );
    expect(withSavings).toContain('HIGH T');
    expect(withSavings).toContain('saves ~2.0K tokens over the period');
    expect(withSavings).toContain('AI review added 2 suggestions');
  });

  it('wraps text at word boundaries', () => {
    expect(wrap('aaa bbb ccc', 9, '  ')).toEqual(['  aaa bbb', '  ccc']);
    expect(wrap('', 10, '  ')).toEqual([]);
  });
});

import type { Recommendation, Severity } from '../domain/recommendation.js';
import type { ReviewContext } from '../domain/review.js';
import type { OptimizationRule } from '../ports/review.js';
import { compact } from '../util/format.js';

export interface FrequentCompactionOptions {
  /** Auto-compactions in one session at or above this are flagged. */
  readonly minAutoCompactions: number;
  readonly listTop: number;
}

const DEFAULTS: FrequentCompactionOptions = { minAutoCompactions: 2, listTop: 3 };

/**
 * Auto-compaction means the context filled up. Doing it repeatedly in one session
 * signals several tasks sharing one conversation, and each summary loses detail.
 */
export class FrequentCompactionRule implements OptimizationRule {
  readonly id = 'frequent-compaction';
  readonly description = 'Sessions that filled the context window and auto-compacted repeatedly';
  readonly defaultSeverity: Severity = 'warn';
  readonly appliesTo = ['window', 'session'] as const;
  private readonly options: FrequentCompactionOptions;

  constructor(options: Partial<FrequentCompactionOptions> = {}) {
    this.options = { ...DEFAULTS, ...options };
  }

  evaluate(ctx: ReviewContext): readonly Recommendation[] {
    const hits = ctx.activity
      .filter((a) => a.autoCompactions >= this.options.minAutoCompactions)
      .sort((a, b) => b.autoCompactions - a.autoCompactions);
    if (hits.length === 0) return [];

    const total = hits.reduce((n, a) => n + a.autoCompactions, 0);
    const peak = Math.max(...hits.map((a) => a.peakContextTokens ?? 0));
    const top = hits
      .slice(0, this.options.listTop)
      .map((a) => `${a.sessionId.slice(0, 8)} (${a.autoCompactions}×)`);

    return [
      {
        ruleId: this.id,
        severity: this.defaultSeverity,
        title: `${hits.length} ${hits.length === 1 ? 'session' : 'sessions'} auto-compacted ${total} times`,
        detail:
          `The context filled up repeatedly${peak > 0 ? ` (up to ${compact(peak)} tokens before compacting)` : ''}. ` +
          `Each compaction replaces the conversation with a summary, which costs a large request and drops detail. ` +
          `Sessions: ${top.join(', ')}.`,
        actions: [
          'Split long work into one session per task',
          'Run /compact yourself at a natural break, with what to keep',
          'Keep CLAUDE.md and always-loaded files short',
        ],
      },
    ];
  }
}

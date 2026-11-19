import type { Recommendation, Severity } from '../domain/recommendation.js';
import type { ReviewContext } from '../domain/review.js';
import { totalTokens } from '../domain/tokens.js';
import type { OptimizationRule } from '../ports/review.js';
import { compact, percent } from '../util/format.js';

export interface LongSessionsOptions {
  /** A session re-reading more cached tokens than this is flagged. */
  readonly cacheReadThreshold: number;
  readonly listTop: number;
}

const DEFAULTS: LongSessionsOptions = { cacheReadThreshold: 20_000_000, listTop: 3 };

/**
 * Every turn re-sends the whole conversation. In long sessions those cache reads
 * dominate token use, even when each new turn is small.
 */
export class LongSessionsRule implements OptimizationRule {
  readonly id = 'long-sessions';
  readonly description = 'Sessions whose context is re-read so often that cache reads dominate';
  readonly defaultSeverity: Severity = 'warn';
  readonly appliesTo = ['window', 'session'] as const;
  private readonly options: LongSessionsOptions;

  constructor(options: Partial<LongSessionsOptions> = {}) {
    this.options = { ...DEFAULTS, ...options };
  }

  evaluate(ctx: ReviewContext): readonly Recommendation[] {
    const long = ctx.sessions
      .filter((s) => s.counts.cacheRead >= this.options.cacheReadThreshold)
      .sort((a, b) => b.counts.cacheRead - a.counts.cacheRead);
    if (long.length === 0) return [];

    const reads = long.reduce((n, s) => n + s.counts.cacheRead, 0);
    const all = long.reduce((n, s) => n + totalTokens(s.counts), 0);
    const top = long
      .slice(0, this.options.listTop)
      .map((s) => `${s.sessionId.slice(0, 8)} (${compact(s.counts.cacheRead)} cache reads)`);
    const plural = long.length === 1 ? 'session' : 'sessions';

    return [
      {
        ruleId: this.id,
        severity: this.defaultSeverity,
        title: `${long.length} long ${plural} re-read over ${compact(this.options.cacheReadThreshold)} cached tokens`,
        detail:
          `Each turn re-sends the whole conversation, so cache reads were ${percent(reads / all)} of the tokens in ${long.length === 1 ? 'this session' : 'these sessions'}. ` +
          `Largest: ${top.join(', ')}. Starting fresh for each task keeps every turn small.`,
        actions: [
          'Start a new session for each separate task',
          'Use /clear between unrelated tasks in the same session',
          'Use /compact with a focus ("/compact keep the API decisions") at natural breaks',
        ],
      },
    ];
  }
}

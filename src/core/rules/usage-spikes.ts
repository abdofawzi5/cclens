import type { Recommendation, Severity } from '../domain/recommendation.js';
import { SessionLabels } from '../domain/session-labels.js';
import type { ReviewContext } from '../domain/review.js';
import { totalTokens } from '../domain/tokens.js';
import type { OptimizationRule } from '../ports/review.js';
import { median } from '../util/estimate-tokens.js';
import { compact, localDay } from '../util/format.js';

export interface UsageSpikesOptions {
  /** A day at or above `factor` × the median day is a spike. */
  readonly factor: number;
  /** Need at least this many active days for a meaningful median. */
  readonly minDays: number;
  readonly listTop: number;
}

const DEFAULTS: UsageSpikesOptions = { factor: 3, minDays: 5, listTop: 3 };

/** Days that used far more than usual, with the session behind each. */
export class UsageSpikesRule implements OptimizationRule {
  readonly id = 'usage-spikes';
  readonly description = 'Days that used several times more tokens than a typical day';
  readonly defaultSeverity: Severity = 'info';
  readonly appliesTo = ['window'] as const;
  private readonly options: UsageSpikesOptions;

  constructor(options: Partial<UsageSpikesOptions> = {}) {
    this.options = { ...DEFAULTS, ...options };
  }

  evaluate(ctx: ReviewContext): readonly Recommendation[] {
    const labels = SessionLabels.from(ctx.activity);
    const days = ctx.daily.map((d) => ({ day: d.period, tokens: totalTokens(d.counts) }));
    if (days.length < this.options.minDays) return [];
    const typical = median(days.map((d) => d.tokens));
    if (typical <= 0) return [];

    const spikes = days
      .filter((d) => d.tokens >= typical * this.options.factor)
      .sort((a, b) => b.tokens - a.tokens)
      .slice(0, this.options.listTop);
    if (spikes.length === 0) return [];

    const described = spikes.map((d) => {
      const heaviest = ctx.sessions
        .filter((s) => localDay(s.lastActivity) === d.day)
        .sort((a, b) => totalTokens(b.counts) - totalTokens(a.counts))[0];
      const who = heaviest ? `, mostly session ${labels.label(heaviest.sessionId)}` : '';
      return `${d.day}: ${compact(d.tokens)} (${(d.tokens / typical).toFixed(1)}× typical${who})`;
    });
    const first = spikes[0];

    return [
      {
        ruleId: this.id,
        severity: this.defaultSeverity,
        title: `${spikes.length} ${spikes.length === 1 ? 'day' : 'days'} used ${this.options.factor}× or more of a typical day`,
        detail: `A typical day used ${compact(typical)} tokens. ${described.join('; ')}. Reviewing what happened on those days usually shows the habit worth changing.`,
        actions: [
          ...(first ? [`cclens tokens session --since ${first.day} --until ${first.day}`] : []),
          'cclens review --session <id>   # review one session in detail',
        ],
      },
    ];
  }
}

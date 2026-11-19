import type { Recommendation, Severity } from '../domain/recommendation.js';
import type { ReviewContext } from '../domain/review.js';
import type { OptimizationRule } from '../ports/review.js';
import { percent } from '../util/format.js';

export interface ModelMixOptions {
  /** Which model names count as the top (most expensive) tier. */
  readonly topTier: RegExp;
  /** Flag when the top tier's share of estimated cost reaches this. */
  readonly minShare: number;
  /** Ignore windows with less estimated cost than this (USD). */
  readonly minCostUsd: number;
}

const DEFAULTS: ModelMixOptions = { topTier: /opus/i, minShare: 0.8, minCostUsd: 5 };

/** Nearly all work on the top model, including routine edits a smaller model handles. */
export class ModelMixRule implements OptimizationRule {
  readonly id = 'model-mix';
  readonly description = 'Almost all usage on the most expensive model tier';
  readonly defaultSeverity: Severity = 'info';
  readonly appliesTo = ['window'] as const;
  private readonly options: ModelMixOptions;

  constructor(options: Partial<ModelMixOptions> = {}) {
    this.options = { ...DEFAULTS, ...options };
  }

  evaluate(ctx: ReviewContext): readonly Recommendation[] {
    let total = 0;
    let top = 0;
    const names = new Set<string>();
    for (const day of ctx.daily) {
      for (const m of day.byModel ?? []) {
        total += m.costUsd;
        if (this.options.topTier.test(m.model)) {
          top += m.costUsd;
          names.add(m.model);
        }
      }
    }
    if (total < this.options.minCostUsd) return [];
    const share = top / total;
    if (share < this.options.minShare) return [];

    return [
      {
        ruleId: this.id,
        severity: this.defaultSeverity,
        title: `${percent(share)} of estimated cost was on ${[...names].join(', ')}`,
        detail:
          'The top model is the right choice for planning and hard problems, but routine work ' +
          '(small edits, renames, running tests, simple questions) costs much less on a smaller model ' +
          'and uses up plan limits more slowly.',
        actions: [
          '/model sonnet for routine sessions; switch back with /model opus when needed',
          'Use a smaller model for scripted runs: claude -p --model sonnet …',
          'Lower /effort for simple tasks',
        ],
      },
    ];
  }
}

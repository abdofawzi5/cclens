import type { Recommendation, Severity } from '../domain/recommendation.js';
import type { ReviewContext } from '../domain/review.js';

/** One optimization check. Pure: no I/O, deterministic for a given context. */
export interface OptimizationRule {
  readonly id: string;
  readonly description: string;
  readonly defaultSeverity: Severity;
  evaluate(ctx: ReviewContext): readonly Recommendation[];
}

/** Optional second opinion from a model. Sees a summary, never raw transcripts. */
export interface AiReviewer {
  review(
    ctx: ReviewContext,
    ruleFindings: readonly Recommendation[],
  ): Promise<readonly Recommendation[]>;
}

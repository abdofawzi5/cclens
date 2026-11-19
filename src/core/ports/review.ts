import type { Recommendation, Severity } from '../domain/recommendation.js';
import type { ReviewContext, ReviewScope, SessionActivity } from '../domain/review.js';

/** One optimization check. Pure: no I/O, deterministic for a given context. */
export interface OptimizationRule {
  readonly id: string;
  readonly description: string;
  readonly defaultSeverity: Severity;
  /** Which review scopes the rule makes sense for. */
  readonly appliesTo: readonly ReviewScope['kind'][];
  evaluate(ctx: ReviewContext): readonly Recommendation[];
}

/** Per-session facts read from transcripts (compactions, prompts…). */
export interface SessionActivitySource {
  read(since?: Date): Promise<readonly SessionActivity[]>;
}

/** Optional second opinion from a model. Sees a summary, never raw transcripts. */
export interface AiReviewer {
  review(
    ctx: ReviewContext,
    ruleFindings: readonly Recommendation[],
  ): Promise<readonly Recommendation[]>;
}

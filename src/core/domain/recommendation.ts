export type Severity = 'info' | 'warn' | 'high';

const SEVERITY_RANK: Record<Severity, number> = { high: 3, warn: 2, info: 1 };

export interface Recommendation {
  readonly ruleId: string;
  readonly severity: Severity;
  readonly title: string;
  readonly detail: string;
  /** Rough tokens saved if acted on; see `savingsBasis` for per what. */
  readonly estimatedTokenSavings?: number;
  /** `per-request`: saved on every request. `window`: saved over the review window. */
  readonly savingsBasis?: 'per-request' | 'window';
  /** Concrete next steps, e.g. commands to run. */
  readonly actions: readonly string[];
}

/** Most severe first, then largest estimated saving first. */
export function compareRecommendations(a: Recommendation, b: Recommendation): number {
  const bySeverity = SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity];
  if (bySeverity !== 0) return bySeverity;
  return (b.estimatedTokenSavings ?? 0) - (a.estimatedTokenSavings ?? 0);
}

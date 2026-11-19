export interface TokenCounts {
  readonly input: number;
  readonly output: number;
  readonly cacheCreation: number;
  readonly cacheRead: number;
}

export const ZERO_TOKENS: TokenCounts = Object.freeze({
  input: 0,
  output: 0,
  cacheCreation: 0,
  cacheRead: 0,
});

export function totalTokens(c: TokenCounts): number {
  return c.input + c.output + c.cacheCreation + c.cacheRead;
}

export function addTokens(a: TokenCounts, b: TokenCounts): TokenCounts {
  return {
    input: a.input + b.input,
    output: a.output + b.output,
    cacheCreation: a.cacheCreation + b.cacheCreation,
    cacheRead: a.cacheRead + b.cacheRead,
  };
}

/** Tokens and cost for one model inside a bucket or session. */
export interface ModelUsage {
  readonly model: string;
  readonly counts: TokenCounts;
  readonly costUsd: number;
}

export type Period = 'day' | 'week' | 'month';

/** Tokens for one calendar period (a day, ISO week or month). */
export interface TokenBucket {
  /** `2026-11-19`, `2026-W47` or `2026-11`, as reported by the provider. */
  readonly period: string;
  readonly counts: TokenCounts;
  /** Estimated cost in USD (API list prices, not your plan's billing). */
  readonly costUsd: number;
  readonly models: readonly string[];
  /** Per-model split, when the provider reports it. */
  readonly byModel?: readonly ModelUsage[];
}

export interface SessionTokens {
  readonly sessionId: string;
  readonly project: string;
  readonly firstActivity: Date;
  readonly lastActivity: Date;
  readonly counts: TokenCounts;
  readonly costUsd: number;
  readonly models: readonly string[];
  readonly byModel?: readonly ModelUsage[];
}

/** A 5-hour billing window. */
export interface UsageBlock {
  readonly start: Date;
  readonly end: Date;
  readonly isActive: boolean;
  readonly counts: TokenCounts;
  readonly costUsd: number;
  readonly tokensPerMinute?: number;
  readonly projectedTokens?: number;
}

export interface TokenFilter {
  readonly since?: Date;
  readonly until?: Date;
  readonly project?: string;
}

export interface ProjectTokens {
  /** Claude Code's encoded project folder, e.g. `-Users-me-Workspace-site`. */
  readonly project: string;
  readonly counts: TokenCounts;
  readonly costUsd: number;
}

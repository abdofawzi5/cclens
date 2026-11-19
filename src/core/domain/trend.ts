import type { SessionActivity } from './review.js';
import { addTokens, type TokenBucket, totalTokens, ZERO_TOKENS } from './tokens.js';
import { localDay } from '../util/format.js';

/** Totals for one review window (`review --compare`, PLAN Phase 11). */
export interface WindowStats {
  readonly since: Date;
  /** Exclusive end. */
  readonly until: Date;
  readonly costUsd: number;
  readonly totalTokens: number;
  readonly sessions: number;
  readonly prompts: number;
  readonly autoCompactions: number;
  /** Cache reads as a share of all tokens; higher is cheaper. */
  readonly cacheReadShare: number;
}

export interface WindowComparison {
  readonly current: WindowStats;
  readonly previous: WindowStats;
}

/**
 * Totals for `[since, until)`: tokens and cost from daily buckets, sessions from
 * transcripts. A session counts in the window its last activity falls in, so a
 * session that spans both windows is counted once.
 */
export function windowStats(
  since: Date,
  until: Date,
  daily: readonly TokenBucket[],
  activity: readonly SessionActivity[],
): WindowStats {
  const from = localDay(since);
  const to = localDay(new Date(until.getTime() - 1));
  const days = daily.filter((d) => d.period >= from && d.period <= to);
  const counts = days.reduce((acc, d) => addTokens(acc, d.counts), ZERO_TOKENS);
  const total = totalTokens(counts);
  const sessions = activity.filter((a) => a.lastActivity >= since && a.lastActivity < until);
  return {
    since,
    until,
    costUsd: days.reduce((n, d) => n + d.costUsd, 0),
    totalTokens: total,
    sessions: new Set(sessions.map((s) => s.sessionId)).size,
    prompts: sessions.reduce((n, s) => n + s.prompts, 0),
    autoCompactions: sessions.reduce((n, s) => n + s.autoCompactions, 0),
    cacheReadShare: total > 0 ? counts.cacheRead / total : 0,
  };
}

/** Relative change from `before` to `after`; undefined when there was nothing before. */
export function change(before: number, after: number): number | undefined {
  return before === 0 ? undefined : (after - before) / before;
}

/** Cost per prompt, a size-independent measure; undefined without prompts. */
export function costPerPrompt(s: WindowStats): number | undefined {
  return s.prompts > 0 ? s.costUsd / s.prompts : undefined;
}

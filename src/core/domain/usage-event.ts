/**
 * How a usage event was captured.
 * - `auto`: Claude invoked the Skill tool (PostToolUse hook)
 * - `typed`: the user typed `/skill` (UserPromptSubmit hook)
 * - `backfill`: recovered from an existing Claude Code transcript
 * - `legacy`: imported from the pre-cclens `skill-usage.log`
 */
export type UsageSource = 'auto' | 'typed' | 'backfill' | 'legacy';

export const USAGE_EVENT_VERSION = 1 as const;

export interface UsageEvent {
  readonly v: typeof USAGE_EVENT_VERSION;
  readonly ts: Date;
  readonly source: UsageSource;
  /** Qualified skill id, e.g. `marketing:seo-audit`. */
  readonly skill: string;
  /** Project folder name the session ran in. */
  readonly project: string;
  readonly sessionId?: string;
}

export interface UsageFilter {
  readonly since?: Date;
  readonly until?: Date;
  readonly skill?: string;
  readonly project?: string;
  /** Only uses recorded in these sessions (uses without a session id are left out). */
  readonly sessionIds?: ReadonlySet<string>;
  readonly sources?: readonly UsageSource[];
}

/** True when the event satisfies every criterion in the filter. */
export function matchesUsageFilter(e: UsageEvent, f: UsageFilter): boolean {
  if (f.since && e.ts < f.since) return false;
  if (f.until && e.ts > f.until) return false;
  if (f.skill !== undefined && e.skill !== f.skill) return false;
  if (f.project !== undefined && e.project !== f.project) return false;
  if (f.sessionIds && !(e.sessionId && f.sessionIds.has(e.sessionId))) return false;
  if (f.sources && !f.sources.includes(e.source)) return false;
  return true;
}

/** Identity used to avoid importing the same event twice. */
export function usageEventKey(e: UsageEvent): string {
  return `${e.ts.toISOString()}|${e.skill}|${e.sessionId ?? ''}`;
}

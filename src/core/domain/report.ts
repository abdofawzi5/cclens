import type { Recommendation } from './recommendation.js';
import type { ReviewSummary } from './review.js';
import type { SessionTitle } from './session-labels.js';
import type { TokenCounts } from './tokens.js';

/** One calendar day in the report window (days with no use are zero, so charts stay continuous). */
export interface ReportDay {
  /** Local day, `YYYY-MM-DD`. */
  readonly day: string;
  readonly counts: TokenCounts;
  readonly tokens: number;
  readonly costUsd: number;
}

export interface ReportModel {
  readonly model: string;
  readonly tokens: number;
  readonly costUsd: number;
}

export interface ReportSession {
  readonly sessionId: string;
  /** `Title (abcd1234)`, or the short id when the session has no title. */
  readonly label: string;
  readonly title?: SessionTitle;
  readonly project: string;
  readonly lastActivity: Date;
  readonly tokens: number;
  readonly costUsd: number;
  readonly prompts: number;
  readonly autoCompactions: number;
}

export interface ReportSkillGroup {
  /** Plugin name, or the skill id for a standalone skill. */
  readonly name: string;
  readonly isPlugin: boolean;
  readonly skills: number;
  /** Listing tokens the group adds to every request. */
  readonly listingTokens: number;
}

/**
 * Everything `cclens report` shows, in one model that every format (Markdown,
 * HTML, JSON) renders. Numbers come from the same data as `review` and `tokens`.
 */
export interface UsageReport {
  readonly generatedAt: Date;
  readonly since: Date;
  readonly until: Date;
  readonly windowDays: number;
  readonly summary: ReviewSummary;
  readonly daily: readonly ReportDay[];
  /** Costliest first; empty when the token provider gives no per-model split. */
  readonly models: readonly ReportModel[];
  /** Costliest sessions first. */
  readonly topSessions: readonly ReportSession[];
  /** Unused plugins and standalone skills, costliest first. */
  readonly unusedSkills: readonly ReportSkillGroup[];
  readonly unusedListingTokens: number;
  readonly findings: readonly Recommendation[];
  /** Data that could not be loaded; the report is partial. */
  readonly notes: readonly string[];
}

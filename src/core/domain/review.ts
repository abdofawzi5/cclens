import type { WindowComparison } from './trend.js';
import type { Agent, AgentRun } from './agent.js';
import type { Recommendation } from './recommendation.js';
import type { SessionTitle } from './session-labels.js';
import type { Skill } from './skill.js';
import type { SessionTokens, TokenBucket } from './tokens.js';

/** What a session's transcript tells us beyond token counts. */
export interface SessionActivity {
  readonly sessionId: string;
  /** Claude Code's encoded project folder, e.g. `-Users-me-Workspace-site`. */
  readonly project: string;
  readonly firstActivity: Date;
  readonly lastActivity: Date;
  /** Prompts the user typed (tool results and system messages excluded). */
  readonly prompts: number;
  readonly autoCompactions: number;
  readonly manualCompactions: number;
  /** Largest context size seen right before a compaction, in tokens. */
  readonly peakContextTokens?: number;
  /** The session's name, when the transcript gives one. */
  readonly title?: SessionTitle;
  /** Set when a scheduled task started the session: the task's name. */
  readonly scheduledTask?: string;
}

/** A review covers either every session in a window, or one session. */
export type ReviewScope =
  | { readonly kind: 'window' }
  | { readonly kind: 'session'; readonly sessionId: string; readonly title?: SessionTitle };

/** Everything a rule may look at. Built once per review by the ReviewService. */
export interface ReviewContext {
  readonly now: Date;
  readonly scope: ReviewScope;
  readonly since: Date;
  readonly windowDays: number;
  readonly installedSkills: readonly Skill[];
  /** Uses per qualified skill id inside the review window. */
  readonly skillUseCounts: ReadonlyMap<string, number>;
  /** Earliest recorded skill use; usage before it is unknown. */
  readonly usageTrackedSince?: Date;
  readonly daily: readonly TokenBucket[];
  readonly sessions: readonly SessionTokens[];
  readonly activity: readonly SessionActivity[];
  /** Installed agents (empty in a session review). */
  readonly installedAgents: readonly Agent[];
  /** Agent tool calls per `subagent_type` in the window. */
  readonly agentCalls: ReadonlyMap<string, number>;
  /** Subagent runs in scope, with tokens per model. */
  readonly agentRuns: readonly AgentRun[];
  /** Tokens per skill in Claude Code's listing, from the latest transcript that has one. */
  readonly skillListing?: Readonly<Record<string, number>>;
}

/** Totals shown above the recommendations. */
export interface ReviewSummary {
  readonly totalTokens: number;
  readonly costUsd: number;
  readonly sessions: number;
  readonly prompts: number;
  readonly autoCompactions: number;
  readonly installedSkills: number;
  readonly usedSkills: number;
}

export type AiReviewStatus =
  { readonly ok: true; readonly count: number } | { readonly ok: false; readonly error: string };

export interface ReviewReport {
  readonly scope: ReviewScope;
  readonly since: Date;
  readonly until: Date;
  readonly summary: ReviewSummary;
  readonly recommendations: readonly Recommendation[];
  readonly rulesRun: readonly string[];
  /** Data that could not be loaded or rules that failed; the report is partial. */
  readonly notes: readonly string[];
  readonly ai?: AiReviewStatus;
  /** This window against the one before it (`--compare`). */
  readonly comparison?: WindowComparison;
}

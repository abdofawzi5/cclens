import { compareRecommendations, type Recommendation } from '../core/domain/recommendation.js';
import { SessionLabels } from '../core/domain/session-labels.js';
import type {
  AiReviewStatus,
  ReviewContext,
  ReviewReport,
  ReviewScope,
  ReviewSummary,
  SessionActivity,
} from '../core/domain/review.js';
import type { Agent, AgentActivity } from '../core/domain/agent.js';
import type { Skill } from '../core/domain/skill.js';
import type { SessionTokens, TokenBucket, TokenCounts } from '../core/domain/tokens.js';
import { addTokens, totalTokens, ZERO_TOKENS } from '../core/domain/tokens.js';
import { describeError, ValidationError } from '../core/errors.js';
import type { Clock } from '../core/ports/infrastructure.js';
import type { AgentActivitySource, AgentSource } from '../core/ports/agents.js';
import type { AiReviewer, OptimizationRule, SessionActivitySource } from '../core/ports/review.js';
import type { SkillSource } from '../core/ports/skills.js';
import { latestSkillListing } from '../core/domain/overhead.js';
import { type WindowComparison, windowStats } from '../core/domain/trend.js';
import type { ContextOverheadSource } from '../core/ports/overhead.js';
import type { TokenUsageProvider } from '../core/ports/tokens.js';
import type { ConfigService } from './config-service.js';
import type { UsageService } from './usage-service.js';

export interface ReviewOptions {
  /** Days to look back (defaults to the config's `review.windowDays`). */
  readonly windowDays?: number;
  /** Review one session (full id or a unique prefix). */
  readonly sessionId?: string;
  /** Review the most recent session. */
  readonly last?: boolean;
  /** Ask the AI reviewer for a second opinion. */
  readonly ai?: boolean;
  /** Run only these rule ids. */
  readonly only?: readonly string[];
  /** Also total the previous window of the same length, for `--compare`. */
  readonly compare?: boolean;
}

export interface RuleInfo {
  readonly id: string;
  readonly description: string;
  readonly severity: string;
  readonly appliesTo: readonly string[];
  readonly enabled: boolean;
}

export interface ReviewDeps {
  readonly config: ConfigService;
  readonly skills: SkillSource;
  readonly usage: UsageService;
  readonly tokens: TokenUsageProvider;
  /** Measured skill listing (Phase 11); estimates are used without it. */
  readonly overhead?: ContextOverheadSource;
  readonly activity: SessionActivitySource;
  readonly clock: Clock;
  readonly rules: readonly OptimizationRule[];
  readonly ai?: AiReviewer;
  readonly agents?: AgentSource;
  readonly agentActivity?: AgentActivitySource;
}

const NO_AGENT_ACTIVITY: AgentActivity = { runs: [], calls: new Map() };

const DAY_MS = 86_400_000;

/**
 * R4: gathers a ReviewContext from every data source, runs the enabled rules
 * (Strategy) and optionally asks an AI reviewer. A failing source or rule makes
 * the report partial (see `notes`) instead of failing the whole review.
 */
export interface ReviewAnalysis {
  readonly report: ReviewReport;
  readonly context: ReviewContext;
}

export class ReviewService {
  constructor(private readonly deps: ReviewDeps) {}

  async rules(): Promise<readonly RuleInfo[]> {
    const disabled = new Set((await this.deps.config.load()).review.disabledRules);
    return this.deps.rules.map((r) => ({
      id: r.id,
      description: r.description,
      severity: r.defaultSeverity,
      appliesTo: r.appliesTo,
      enabled: !disabled.has(r.id),
    }));
  }

  async review(options: ReviewOptions = {}): Promise<ReviewReport> {
    return (await this.analyse(options)).report;
  }

  /** The review plus the data it was built from, so other views (reports) reuse one load. */
  async analyse(options: ReviewOptions = {}): Promise<ReviewAnalysis> {
    const config = (await this.deps.config.load()).review;
    const windowDays = options.windowDays ?? config.windowDays;
    const now = this.deps.clock.now();
    const since = startOfDay(new Date(now.getTime() - (windowDays - 1) * DAY_MS));
    const notes: string[] = [];
    const sessionMode = options.sessionId !== undefined || options.last === true;

    const load = async <T>(what: string, fallback: T, task: () => Promise<T>): Promise<T> => {
      try {
        return await task();
      } catch (error) {
        notes.push(`Could not load ${what}: ${describeError(error)}`);
        return fallback;
      }
    };

    const overhead = this.deps.overhead;
    const listingTask: Promise<Readonly<Record<string, number>> | undefined> =
      sessionMode || !overhead
        ? Promise.resolve(undefined)
        : overhead
            .read(since)
            .then(latestSkillListing)
            .catch(() => undefined);
    const agentSource = this.deps.agents;
    const agentActivity = this.deps.agentActivity;
    const [installed, counts, firstUse, daily, allSessions, allActivity, agents, allAgentActivity] =
      await Promise.all([
        sessionMode
          ? []
          : load('installed skills', [] as readonly Skill[], () => this.deps.skills.list()),
        sessionMode
          ? new Map<string, number>()
          : load('skill uses', new Map<string, number>() as ReadonlyMap<string, number>, () =>
              this.deps.usage.countBySkill({ since }),
            ),
        sessionMode ? undefined : this.deps.usage.firstUse().catch(() => undefined),
        sessionMode
          ? []
          : load('daily tokens (ccusage)', [] as readonly TokenBucket[], () =>
              this.deps.tokens.byPeriod('day', { since }),
            ),
        load('session tokens (ccusage)', [] as readonly SessionTokens[], () =>
          this.deps.tokens.bySession(sessionMode && !options.last ? {} : { since }),
        ),
        load('session activity (transcripts)', [] as readonly SessionActivity[], () =>
          this.deps.activity.read(sessionMode && !options.last ? undefined : since),
        ),
        sessionMode || !agentSource
          ? ([] as readonly Agent[])
          : load('installed agents', [] as readonly Agent[], () => agentSource.list()),
        agentActivity
          ? load('agent runs (transcripts)', NO_AGENT_ACTIVITY, () =>
              agentActivity.read(sessionMode && !options.last ? undefined : since),
            )
          : NO_AGENT_ACTIVITY,
      ]);
    const skillListing = await listingTask;

    let scope: ReviewScope = { kind: 'window' };
    let sessions = allSessions;
    let activity = allActivity;
    let agentRuns = allAgentActivity.runs;
    if (sessionMode) {
      const labels = SessionLabels.from(allActivity);
      const id = this.resolveSession(options, allSessions, allActivity, labels);
      const title = labels.title(id);
      scope = { kind: 'session', sessionId: id, ...(title ? { title } : {}) };
      sessions = allSessions.filter((s) => s.sessionId === id);
      activity = allActivity.filter((a) => a.sessionId === id);
      agentRuns = agentRuns.filter((r) => r.sessionId === id);
    }

    const ctx: ReviewContext = {
      now,
      scope,
      since,
      windowDays,
      installedSkills: installed,
      skillUseCounts: counts,
      ...(firstUse ? { usageTrackedSince: firstUse } : {}),
      daily,
      sessions,
      activity,
      installedAgents: agents,
      agentCalls: allAgentActivity.calls,
      agentRuns,
      ...(skillListing ? { skillListing } : {}),
    };

    const disabled = new Set(config.disabledRules);
    const only = options.only ? new Set(options.only) : undefined;
    if (only) {
      const known = new Set(this.deps.rules.map((r) => r.id));
      const unknown = [...only].filter((id) => !known.has(id));
      if (unknown.length > 0) {
        throw new ValidationError(
          `Unknown rule: ${unknown.join(', ')}. Run \`cclens review --list-rules\`.`,
        );
      }
    }
    const rules = this.deps.rules.filter(
      (r) => r.appliesTo.includes(scope.kind) && (only ? only.has(r.id) : !disabled.has(r.id)),
    );

    const findings: Recommendation[] = [];
    for (const rule of rules) {
      try {
        findings.push(...rule.evaluate(ctx));
      } catch (error) {
        notes.push(`Rule ${rule.id} failed: ${describeError(error)}`);
      }
    }
    findings.sort(compareRecommendations);

    let ai: AiReviewStatus | undefined;
    const recommendations: Recommendation[] = [...findings];
    if (options.ai) {
      if (!this.deps.ai) {
        ai = { ok: false, error: 'No AI reviewer is configured.' };
      } else {
        try {
          const extra = [...(await this.deps.ai.review(ctx, findings))].sort(
            compareRecommendations,
          );
          recommendations.push(...extra);
          ai = { ok: true, count: extra.length };
        } catch (error) {
          ai = { ok: false, error: describeError(error) };
        }
      }
    }

    const report: ReviewReport = {
      scope,
      since: scope.kind === 'session' ? (sessions[0]?.firstActivity ?? since) : since,
      until: now,
      summary: summarize(ctx),
      recommendations,
      rulesRun: rules.map((r) => r.id),
      notes,
      ...(ai ? { ai } : {}),
    };
    if (options.compare && scope.kind === 'window') {
      const comparison = await load('the previous window', undefined, () =>
        this.compare(since, now, windowDays, activity),
      );
      if (comparison) return { report: { ...report, comparison, notes }, context: ctx };
    }
    return { report, context: ctx };
  }

  /** Totals for `[since, now]` and the window of the same length before it. */
  private async compare(
    since: Date,
    now: Date,
    windowDays: number,
    current: readonly SessionActivity[],
  ): Promise<WindowComparison> {
    const before = startOfDay(new Date(since.getTime() - windowDays * DAY_MS));
    const [daily, activity] = await Promise.all([
      this.deps.tokens.byPeriod('day', { since: before }),
      this.deps.activity.read(before),
    ]);
    const until = new Date(now.getTime() + 1);
    return {
      current: windowStats(since, until, daily, current),
      previous: windowStats(before, since, daily, activity),
    };
  }

  private resolveSession(
    options: ReviewOptions,
    sessions: readonly SessionTokens[],
    activity: readonly SessionActivity[],
    labels: SessionLabels,
  ): string {
    const ids = new Map<string, Date>();
    for (const s of [...sessions, ...activity]) {
      const prev = ids.get(s.sessionId);
      if (!prev || s.lastActivity > prev) ids.set(s.sessionId, s.lastActivity);
    }
    if (options.last) {
      const latest = [...ids].sort((a, b) => b[1].getTime() - a[1].getTime())[0];
      if (!latest) throw new ValidationError('No sessions found in the review window.');
      return latest[0];
    }
    const wanted = options.sessionId ?? '';
    const match = labels.resolve(wanted, ids.keys());
    if (match.kind === 'one') return match.sessionId;
    if (match.kind === 'none') {
      throw new ValidationError(
        `No session matches "${wanted}" by id or title. List sessions with \`cclens tokens session\`.`,
      );
    }
    const shown = match.sessionIds.slice(0, 5).map((id) => `  ${labels.label(id)}`);
    const more = match.sessionIds.length > 5 ? [`  …and ${match.sessionIds.length - 5} more`] : [];
    throw new ValidationError(
      [
        `"${wanted}" matches ${match.sessionIds.length} sessions; use more of the id or title:`,
        ...shown,
        ...more,
      ].join('\n'),
    );
  }
}

function summarize(ctx: ReviewContext): ReviewSummary {
  const rows: readonly { counts: TokenCounts; costUsd: number }[] =
    ctx.scope.kind === 'session' ? ctx.sessions : ctx.daily;
  const counts = rows.reduce<TokenCounts>((acc, r) => addTokens(acc, r.counts), ZERO_TOKENS);
  const ids = new Set([...ctx.sessions, ...ctx.activity].map((s) => s.sessionId));
  return {
    totalTokens: totalTokens(counts),
    costUsd: rows.reduce((n, r) => n + r.costUsd, 0),
    sessions: ids.size,
    prompts: ctx.activity.reduce((n, a) => n + a.prompts, 0),
    autoCompactions: ctx.activity.reduce((n, a) => n + a.autoCompactions, 0),
    installedSkills: ctx.installedSkills.length,
    usedSkills: [...ctx.skillUseCounts.values()].filter((n) => n > 0).length,
  };
}

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

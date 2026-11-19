import { compareRecommendations, type Recommendation } from '../core/domain/recommendation.js';
import type {
  AiReviewStatus,
  ReviewContext,
  ReviewReport,
  ReviewScope,
  ReviewSummary,
  SessionActivity,
} from '../core/domain/review.js';
import type { Skill } from '../core/domain/skill.js';
import type { SessionTokens, TokenBucket, TokenCounts } from '../core/domain/tokens.js';
import { addTokens, totalTokens, ZERO_TOKENS } from '../core/domain/tokens.js';
import { describeError, ValidationError } from '../core/errors.js';
import type { Clock } from '../core/ports/infrastructure.js';
import type { AiReviewer, OptimizationRule, SessionActivitySource } from '../core/ports/review.js';
import type { SkillSource } from '../core/ports/skills.js';
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
  readonly activity: SessionActivitySource;
  readonly clock: Clock;
  readonly rules: readonly OptimizationRule[];
  readonly ai?: AiReviewer;
}

const DAY_MS = 86_400_000;

/**
 * R4: gathers a ReviewContext from every data source, runs the enabled rules
 * (Strategy) and optionally asks an AI reviewer. A failing source or rule makes
 * the report partial (see `notes`) instead of failing the whole review.
 */
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

    const [installed, counts, firstUse, daily, allSessions, allActivity] = await Promise.all([
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
    ]);

    let scope: ReviewScope = { kind: 'window' };
    let sessions = allSessions;
    let activity = allActivity;
    if (sessionMode) {
      const id = this.resolveSession(options, allSessions, allActivity);
      scope = { kind: 'session', sessionId: id };
      sessions = allSessions.filter((s) => s.sessionId === id);
      activity = allActivity.filter((a) => a.sessionId === id);
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

    return {
      scope,
      since: scope.kind === 'session' ? (sessions[0]?.firstActivity ?? since) : since,
      until: now,
      summary: summarize(ctx),
      recommendations,
      rulesRun: rules.map((r) => r.id),
      notes,
      ...(ai ? { ai } : {}),
    };
  }

  private resolveSession(
    options: ReviewOptions,
    sessions: readonly SessionTokens[],
    activity: readonly SessionActivity[],
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
    const matches = [...ids.keys()].filter((id) => id.startsWith(wanted));
    if (matches.length === 1 && matches[0]) return matches[0];
    if (matches.length === 0) {
      throw new ValidationError(
        `No session matches "${wanted}". List sessions with \`cclens tokens session\`.`,
      );
    }
    throw new ValidationError(
      `"${wanted}" matches ${matches.length} sessions; use more characters of the id.`,
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

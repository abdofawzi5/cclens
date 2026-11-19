import type { ReportDay, ReportModel, ReportSession, UsageReport } from '../core/domain/report.js';
import type { ReviewContext } from '../core/domain/review.js';
import { SessionLabels } from '../core/domain/session-labels.js';
import { addTokens, totalTokens, ZERO_TOKENS } from '../core/domain/tokens.js';
import { skillGroups } from '../core/rules/unused-skills.js';
import { localDay } from '../core/util/format.js';
import type { ReviewAnalysis, ReviewService } from './review-service.js';

export interface ReportOptions {
  /** Days to look back (defaults to the config's `review.windowDays`). */
  readonly windowDays?: number;
  /** How many of the costliest sessions to list. */
  readonly topSessions?: number;
}

const DEFAULT_TOP_SESSIONS = 10;

/**
 * Builds the `UsageReport` behind `cclens report`. It runs one review and reuses
 * the data that review loaded, so the report's numbers match `cclens review`.
 */
export class ReportService {
  constructor(private readonly review: Pick<ReviewService, 'analyse'>) {}

  async build(options: ReportOptions = {}): Promise<UsageReport> {
    const analysis = await this.review.analyse(
      options.windowDays ? { windowDays: options.windowDays } : {},
    );
    return buildUsageReport(analysis, options.topSessions ?? DEFAULT_TOP_SESSIONS);
  }
}

/** Pure: turns a review and its context into the report model. */
export function buildUsageReport(
  { report, context }: Pick<ReviewAnalysis, 'report' | 'context'>,
  topSessions: number = DEFAULT_TOP_SESSIONS,
): UsageReport {
  const groups = skillGroups(context.installedSkills, context.skillUseCounts).filter(
    (g) => g.uses === 0,
  );
  return {
    generatedAt: context.now,
    since: report.since,
    until: report.until,
    windowDays: context.windowDays,
    summary: report.summary,
    daily: dailySeries(context),
    models: modelSplit(context),
    topSessions: costliestSessions(context, topSessions),
    unusedSkills: groups.map((g) => ({
      name: g.name,
      isPlugin: g.isPlugin,
      skills: g.skills.length,
      listingTokens: g.tokens,
    })),
    unusedListingTokens: groups.reduce((n, g) => n + g.tokens, 0),
    findings: report.recommendations,
    notes: report.notes,
  };
}

function dailySeries(ctx: ReviewContext): readonly ReportDay[] {
  const byDay = new Map(ctx.daily.map((b) => [b.period, b]));
  const days: ReportDay[] = [];
  const cursor = new Date(ctx.since.getFullYear(), ctx.since.getMonth(), ctx.since.getDate());
  const last = localDay(ctx.now);
  // Walk calendar days (not 24-hour steps) so DST changes never skip or repeat a day.
  for (let i = 0; i < 400; i++) {
    const day = localDay(cursor);
    const bucket = byDay.get(day);
    const counts = bucket?.counts ?? ZERO_TOKENS;
    days.push({ day, counts, tokens: totalTokens(counts), costUsd: bucket?.costUsd ?? 0 });
    if (day >= last) break;
    cursor.setDate(cursor.getDate() + 1);
  }
  return days;
}

function modelSplit(ctx: ReviewContext): readonly ReportModel[] {
  const models = new Map<string, { counts: typeof ZERO_TOKENS; costUsd: number }>();
  for (const bucket of ctx.daily) {
    for (const m of bucket.byModel ?? []) {
      const prev = models.get(m.model) ?? { counts: ZERO_TOKENS, costUsd: 0 };
      models.set(m.model, {
        counts: addTokens(prev.counts, m.counts),
        costUsd: prev.costUsd + m.costUsd,
      });
    }
  }
  return [...models]
    .map(([model, v]) => ({ model, tokens: totalTokens(v.counts), costUsd: v.costUsd }))
    .sort((a, b) => b.costUsd - a.costUsd || b.tokens - a.tokens);
}

function costliestSessions(ctx: ReviewContext, limit: number): readonly ReportSession[] {
  const labels = SessionLabels.from(ctx.activity);
  const activity = new Map(ctx.activity.map((a) => [a.sessionId, a]));
  return [...ctx.sessions]
    .sort((a, b) => b.costUsd - a.costUsd || totalTokens(b.counts) - totalTokens(a.counts))
    .slice(0, limit)
    .map((s) => {
      const a = activity.get(s.sessionId);
      const title = labels.title(s.sessionId);
      return {
        sessionId: s.sessionId,
        label: labels.label(s.sessionId),
        ...(title ? { title } : {}),
        project: s.project,
        lastActivity: s.lastActivity,
        tokens: totalTokens(s.counts),
        costUsd: s.costUsd,
        prompts: a?.prompts ?? 0,
        autoCompactions: a?.autoCompactions ?? 0,
      };
    });
}

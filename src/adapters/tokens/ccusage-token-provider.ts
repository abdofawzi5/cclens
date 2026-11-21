import type { z } from 'zod';
import type {
  ModelUsage,
  Period,
  ProjectTokens,
  SessionTokens,
  TokenBucket,
  TokenCounts,
  TokenFilter,
  UsageBlock,
} from '../../core/domain/tokens.js';
import { addTokens, ZERO_TOKENS } from '../../core/domain/tokens.js';
import { IntegrationError } from '../../core/errors.js';
import type { ProcessRunner } from '../../core/ports/infrastructure.js';
import type { TokenUsageProvider } from '../../core/ports/tokens.js';
import {
  blocksReport,
  dailyReport,
  monthlyReport,
  projectsReport,
  sessionReport,
  weeklyReport,
  type CountsRow,
  type ModelBreakdownRow,
} from './ccusage-schemas.js';

const toCounts = (r: CountsRow): TokenCounts => ({
  input: r.inputTokens,
  output: r.outputTokens,
  cacheCreation: r.cacheCreationTokens,
  cacheRead: r.cacheReadTokens,
});

const toModels = (rows: readonly ModelBreakdownRow[]): readonly ModelUsage[] =>
  rows.map((m) => ({ model: m.modelName, counts: toCounts(m), costUsd: m.cost }));

const ymd = (d: Date): string =>
  `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;

export interface CcusageOptions {
  /** Command and leading args that start ccusage, e.g. `[node, /path/to/ccusage/src/cli.js]`. */
  readonly command: readonly [string, ...string[]];
  readonly timeoutMs?: number;
}

/**
 * Adapter: TokenUsageProvider over the ccusage CLI (`claude` reports, `--json --offline`).
 * Output is validated with zod so a ccusage format change fails loudly, not silently.
 */
export class CcusageTokenProvider implements TokenUsageProvider {
  constructor(
    private readonly runner: ProcessRunner,
    private readonly options: CcusageOptions,
  ) {}

  async byPeriod(period: Period, filter: TokenFilter = {}): Promise<readonly TokenBucket[]> {
    if (period === 'day') {
      const r = await this.run('daily', dailyReport, filter);
      return r.daily.map((d) => this.bucket(d.date, d));
    }
    if (period === 'week') {
      const r = await this.run('weekly', weeklyReport, filter);
      return r.weekly.map((d) => this.bucket(d.week, d));
    }
    const r = await this.run('monthly', monthlyReport, filter);
    return r.monthly.map((d) => this.bucket(d.month, d));
  }

  async bySession(filter: TokenFilter = {}): Promise<readonly SessionTokens[]> {
    const r = await this.run('session', sessionReport, filter);
    return r.sessions.map((s) => ({
      sessionId: s.sessionId,
      project: s.projectPath,
      firstActivity: new Date(s.firstActivity),
      lastActivity: new Date(s.lastActivity),
      counts: toCounts(s),
      costUsd: s.totalCost,
      models: s.modelsUsed,
      byModel: toModels(s.modelBreakdowns),
    }));
  }

  async byProject(filter: TokenFilter = {}): Promise<readonly ProjectTokens[]> {
    const r = await this.run('daily', projectsReport, filter, ['--instances']);
    return Object.entries(r.projects)
      .map(([project, days]) => ({
        project,
        counts: days.reduce<TokenCounts>((acc, d) => addTokens(acc, toCounts(d)), ZERO_TOKENS),
        costUsd: days.reduce((acc, d) => acc + d.totalCost, 0),
      }))
      .sort((a, b) => b.costUsd - a.costUsd);
  }

  async blocks(filter: TokenFilter = {}): Promise<readonly UsageBlock[]> {
    const r = await this.run('blocks', blocksReport, filter);
    return r.blocks
      .filter((b) => !b.isGap)
      .map((b) => ({
        start: new Date(b.startTime),
        end: new Date(b.endTime),
        isActive: b.isActive,
        counts: {
          input: b.tokenCounts.inputTokens,
          output: b.tokenCounts.outputTokens,
          cacheCreation: b.tokenCounts.cacheCreationInputTokens,
          cacheRead: b.tokenCounts.cacheReadInputTokens,
        },
        costUsd: b.costUSD,
        ...(b.burnRate ? { tokensPerMinute: b.burnRate.tokensPerMinute } : {}),
        ...(b.projection ? { projectedTokens: b.projection.totalTokens } : {}),
      }));
  }

  private bucket(
    period: string,
    row: CountsRow & {
      totalCost: number;
      modelsUsed: string[];
      modelBreakdowns: ModelBreakdownRow[];
    },
  ): TokenBucket {
    return {
      period,
      counts: toCounts(row),
      costUsd: row.totalCost,
      models: row.modelsUsed,
      byModel: toModels(row.modelBreakdowns),
    };
  }

  private async run<S extends z.ZodType>(
    report: string,
    schema: S,
    filter: TokenFilter,
    extra: readonly string[] = [],
  ): Promise<z.infer<S>> {
    const [command, ...prefix] = this.options.command;
    const args = [...prefix, 'claude', report, '--json', '--offline', ...extra];
    if (filter.since) args.push('--since', ymd(filter.since));
    if (filter.until) args.push('--until', ymd(filter.until));
    // One argument: project names start with "-", which ccusage would read as a flag.
    if (filter.project) args.push(`--project=${filter.project}`);

    const result = await this.runner.run(command, args, {
      timeoutMs: this.options.timeoutMs ?? 120_000,
      env: { NO_COLOR: '1' },
    });
    if (result.exitCode !== 0) {
      throw new IntegrationError(
        'ccusage',
        `ccusage ${report} failed: ${result.stderr.trim() || `exit ${result.exitCode}`}`,
      );
    }
    let json: unknown;
    try {
      json = JSON.parse(result.stdout);
    } catch (cause) {
      throw new IntegrationError('ccusage', `ccusage ${report} did not return JSON`, { cause });
    }
    // An empty report (no usage in range) comes back without the array key.
    const parsed = schema.safeParse(json);
    if (parsed.success) return parsed.data;
    if (json !== null && typeof json === 'object') {
      const empty = { daily: [], weekly: [], monthly: [], sessions: [], blocks: [], projects: {} };
      const retry = schema.safeParse({ ...empty, ...json });
      if (retry.success) return retry.data;
    }
    throw new IntegrationError(
      'ccusage',
      `Unexpected ccusage ${report} output; it may have changed format. ${parsed.error.issues[0]?.message ?? ''}`,
    );
  }
}

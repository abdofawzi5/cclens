import { type Agent, type AgentRun, BUILTIN_AGENT_TYPES, costOf } from '../core/domain/agent.js';
import { SessionLabels } from '../core/domain/session-labels.js';
import {
  type SessionTokens,
  type TokenCounts,
  addTokens,
  totalTokens,
  ZERO_TOKENS,
} from '../core/domain/tokens.js';
import { describeError } from '../core/errors.js';
import type {
  AgentActivitySource,
  AgentSource,
  PriceList,
  PriceTable,
} from '../core/ports/agents.js';
import type { SessionActivitySource } from '../core/ports/review.js';
import type { TokenUsageProvider } from '../core/ports/tokens.js';

/** How a cost figure was worked out. */
export type CostBasis = 'priced' | 'share' | 'mixed';

/** One run's two cost figures (see PLAN Phase 8). */
export interface RunCost {
  /** Every message priced by its own model; undefined when a model has no price. */
  readonly pricedUsd?: number;
  /** The run's share of its session's tokens times the session's ccusage cost. */
  readonly shareUsd: number;
  /** Run tokens / session tokens; undefined when ccusage does not know the session. */
  readonly share?: number;
}

export function runCost(run: AgentRun, session?: SessionTokens, prices?: PriceTable): RunCost {
  const runTokens = totalTokens(run.counts);
  const sessionTokens = session ? totalTokens(session.counts) : 0;
  const share = sessionTokens > 0 ? Math.min(1, runTokens / sessionTokens) : undefined;
  let priced: number | undefined = prices ? 0 : undefined;
  for (const m of run.byModel) {
    const price = prices?.price(m.model);
    if (!price || priced === undefined) {
      priced = undefined;
      break;
    }
    priced += costOf(m.counts, price);
  }
  return {
    ...(priced === undefined ? {} : { pricedUsd: priced }),
    shareUsd: share !== undefined && session ? share * session.costUsd : 0,
    ...(share === undefined ? {} : { share }),
  };
}

export interface AgentRow {
  readonly agentType: string;
  /** The installed definition, when the type is installed here. */
  readonly agent?: Agent;
  readonly builtin: boolean;
  /** Agent tool calls, including ones that failed to start. */
  readonly calls: number;
  /** Runs with a transcript (and token counts). */
  readonly runs: number;
  readonly sessions: number;
  readonly counts: TokenCounts;
  readonly tokens: number;
  readonly models: readonly string[];
  /** Priced per model where every model has a price, else the share figure. */
  readonly costUsd: number;
  readonly costBasis: CostBasis;
  readonly shareCostUsd: number;
}

export interface AgentSessionRow {
  readonly sessionId: string;
  readonly label: string;
  readonly project: string;
  readonly runs: number;
  readonly agentTypes: readonly string[];
  readonly agentTokens: number;
  readonly sessionTokens?: number;
  readonly costUsd: number;
  readonly costBasis: CostBasis;
}

export interface AgentReport {
  readonly since?: Date;
  /** Installed agents (personal, project and plugin; built-ins not counted). */
  readonly installed: number;
  /** Agent types used in the window, costliest first. */
  readonly byType: readonly AgentRow[];
  /** Sessions with agent runs, costliest agent spend first. */
  readonly bySession: readonly AgentSessionRow[];
  /** Installed agents with no call in the window. */
  readonly unused: readonly Agent[];
  readonly totals: {
    readonly calls: number;
    readonly runs: number;
    readonly tokens: number;
    readonly costUsd: number;
  };
  readonly pricesLoaded: boolean;
  readonly notes: readonly string[];
}

export interface AgentDeps {
  readonly agents: AgentSource;
  readonly activity: AgentActivitySource;
  readonly tokens: TokenUsageProvider;
  readonly prices: PriceList;
  readonly sessions?: SessionActivitySource;
}

/** `cclens agents`: installed agents, what they were used for, and what they cost. */
export class AgentService {
  constructor(private readonly deps: AgentDeps) {}

  async report(options: { since?: Date } = {}): Promise<AgentReport> {
    const notes: string[] = [];
    const load = async <T>(what: string, fallback: T, task: () => Promise<T>): Promise<T> => {
      try {
        return await task();
      } catch (error) {
        notes.push(`Could not load ${what}: ${describeError(error)}`);
        return fallback;
      }
    };
    const filter = options.since ? { since: options.since } : {};
    const [installed, activity, sessions, prices, titles] = await Promise.all([
      load('installed agents', [] as readonly Agent[], () => this.deps.agents.list()),
      load('agent runs (transcripts)', { runs: [], calls: new Map<string, number>() }, () =>
        this.deps.activity.read(options.since),
      ),
      load('session tokens (ccusage)', [] as readonly SessionTokens[], () =>
        this.deps.tokens.bySession(filter),
      ),
      this.deps.prices.load().catch((error: unknown) => {
        notes.push(
          `Could not load model prices (${describeError(error)}); costs are each run's share of its session instead.`,
        );
        return undefined;
      }),
      this.deps.sessions ? this.deps.sessions.read(options.since).catch(() => []) : [],
    ]);

    const sessionById = new Map(sessions.map((s) => [s.sessionId, s]));
    const agentById = new Map(installed.map((a) => [a.id, a]));
    const costs = new Map(
      activity.runs.map((r) => [r, runCost(r, sessionById.get(r.sessionId), prices)]),
    );

    const types = new Set([...activity.calls.keys(), ...activity.runs.map((r) => r.agentType)]);
    const byType: AgentRow[] = [...types].map((type) => {
      const runs = activity.runs.filter((r) => r.agentType === type);
      const agent = agentById.get(type);
      return {
        agentType: type,
        ...(agent ? { agent } : {}),
        builtin: BUILTIN_AGENT_TYPES.has(type),
        calls: Math.max(activity.calls.get(type) ?? 0, runs.length),
        runs: runs.length,
        sessions: new Set(runs.map((r) => r.sessionId)).size,
        ...sumRuns(runs, costs),
      };
    });
    byType.sort((a, b) => b.costUsd - a.costUsd || b.calls - a.calls);

    const labels = SessionLabels.from(titles);
    const runsBySession = new Map<string, AgentRun[]>();
    for (const r of activity.runs) {
      const list = runsBySession.get(r.sessionId) ?? [];
      list.push(r);
      runsBySession.set(r.sessionId, list);
    }
    const bySession: AgentSessionRow[] = [...runsBySession].map(([sessionId, runs]) => {
      const sum = sumRuns(runs, costs);
      const session = sessionById.get(sessionId);
      return {
        sessionId,
        label: labels.label(sessionId),
        project: runs[0]?.project ?? '',
        runs: runs.length,
        agentTypes: [...new Set(runs.map((r) => r.agentType))],
        agentTokens: sum.tokens,
        ...(session ? { sessionTokens: totalTokens(session.counts) } : {}),
        costUsd: sum.costUsd,
        costBasis: sum.costBasis,
      };
    });
    bySession.sort((a, b) => b.costUsd - a.costUsd || b.agentTokens - a.agentTokens);

    const used = new Set(types);
    const unused = installed
      .filter((a) => !used.has(a.id) && !BUILTIN_AGENT_TYPES.has(a.id))
      .sort((a, b) => a.id.localeCompare(b.id));

    return {
      ...(options.since ? { since: options.since } : {}),
      installed: installed.length,
      byType,
      bySession,
      unused,
      totals: {
        calls: byType.reduce((n, r) => n + r.calls, 0),
        runs: activity.runs.length,
        tokens: byType.reduce((n, r) => n + r.tokens, 0),
        costUsd: byType.reduce((n, r) => n + r.costUsd, 0),
      },
      pricesLoaded: prices !== undefined,
      notes,
    };
  }
}

function sumRuns(
  runs: readonly AgentRun[],
  costs: ReadonlyMap<AgentRun, RunCost>,
): Pick<AgentRow, 'counts' | 'tokens' | 'models' | 'costUsd' | 'costBasis' | 'shareCostUsd'> {
  let counts = ZERO_TOKENS;
  let costUsd = 0;
  let shareCostUsd = 0;
  let priced = 0;
  const models = new Set<string>();
  for (const r of runs) {
    counts = addTokens(counts, r.counts);
    for (const m of r.byModel) models.add(m.model);
    const c = costs.get(r);
    shareCostUsd += c?.shareUsd ?? 0;
    if (c?.pricedUsd !== undefined) {
      costUsd += c.pricedUsd;
      priced++;
    } else {
      costUsd += c?.shareUsd ?? 0;
    }
  }
  const costBasis: CostBasis =
    priced === runs.length && runs.length > 0 ? 'priced' : priced === 0 ? 'share' : 'mixed';
  return {
    counts,
    tokens: totalTokens(counts),
    models: [...models],
    costUsd,
    costBasis,
    shareCostUsd,
  };
}

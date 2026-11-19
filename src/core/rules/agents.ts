import { BUILTIN_AGENT_TYPES } from '../domain/agent.js';
import type { Recommendation, Severity } from '../domain/recommendation.js';
import type { ReviewContext } from '../domain/review.js';
import { totalTokens } from '../domain/tokens.js';
import type { OptimizationRule } from '../ports/review.js';
import { estimateTokens } from '../util/estimate-tokens.js';
import { compact, percent } from '../util/format.js';

export interface UnusedAgentsOptions {
  /** Above this many listing tokens the finding is a warning, not a tip. */
  readonly warnAboveTokens: number;
  readonly listTop: number;
}

/**
 * Installed agents never called in the window. Claude Code lists every agent's
 * name and description in the Agent tool on each request, so unused ones cost tokens.
 */
export class UnusedAgentsRule implements OptimizationRule {
  readonly id = 'unused-agents';
  readonly description = 'Installed subagents with no recorded call in the review window';
  readonly defaultSeverity: Severity = 'info';
  readonly appliesTo = ['window'] as const;
  private readonly options: UnusedAgentsOptions;

  constructor(options: Partial<UnusedAgentsOptions> = {}) {
    this.options = { warnAboveTokens: 2_000, listTop: 5, ...options };
  }

  evaluate(ctx: ReviewContext): readonly Recommendation[] {
    const unused = ctx.installedAgents
      .filter((a) => !BUILTIN_AGENT_TYPES.has(a.id) && (ctx.agentCalls.get(a.id) ?? 0) === 0)
      .map((a) => ({ agent: a, tokens: estimateTokens(`- ${a.id}: ${a.description ?? ''}`) }))
      .sort((a, b) => b.tokens - a.tokens);
    if (unused.length === 0) return [];

    const tokens = unused.reduce((n, u) => n + u.tokens, 0);
    const byPlugin = new Map<string, number>();
    for (const u of unused) {
      const key = u.agent.plugin ?? u.agent.scope;
      byPlugin.set(key, (byPlugin.get(key) ?? 0) + 1);
    }
    const sources = [...byPlugin]
      .sort((a, b) => b[1] - a[1])
      .slice(0, this.options.listTop)
      .map(([name, n]) => `${name} (${n})`);

    return [
      {
        ruleId: this.id,
        severity: tokens > this.options.warnAboveTokens ? 'warn' : 'info',
        title: `${unused.length} installed agents unused in ${ctx.windowDays} days`,
        detail: [
          `${unused.length} of ${ctx.installedAgents.length} installed agents were never called in the last ${ctx.windowDays} days.`,
          `Their names and descriptions add about ${compact(tokens)} tokens to the Agent tool's description on every request.`,
          `Most come from: ${sources.join(', ')}.`,
        ].join(' '),
        estimatedTokenSavings: tokens,
        savingsBasis: 'per-request',
        actions: [
          'cclens agents --unused   # see which ones',
          'Plugin agents: claude plugin disable <name> (turns off the whole plugin)',
          'Your own agents: delete or move ~/.claude/agents/<name>.md',
        ],
      },
    ];
  }
}

export interface ExpensiveAgentsOptions {
  /** A run using at least this share of its session's tokens is flagged… */
  readonly minShare: number;
  /** …if it also used at least this many tokens. */
  readonly minTokens: number;
  readonly listTop: number;
}

/** Subagent runs that took a large share of their session's tokens. */
export class ExpensiveAgentsRule implements OptimizationRule {
  readonly id = 'expensive-agents';
  readonly description = 'Subagent runs that used a large share of their session’s tokens';
  readonly defaultSeverity: Severity = 'warn';
  readonly appliesTo = ['window', 'session'] as const;
  private readonly options: ExpensiveAgentsOptions;

  constructor(options: Partial<ExpensiveAgentsOptions> = {}) {
    this.options = { minShare: 0.4, minTokens: 1_000_000, listTop: 3, ...options };
  }

  evaluate(ctx: ReviewContext): readonly Recommendation[] {
    const sessionTokens = new Map(ctx.sessions.map((s) => [s.sessionId, totalTokens(s.counts)]));
    const heavy = ctx.agentRuns.flatMap((run) => {
      const tokens = totalTokens(run.counts);
      const total = sessionTokens.get(run.sessionId) ?? 0;
      if (total === 0 || tokens < this.options.minTokens) return [];
      const share = Math.min(1, tokens / total);
      return share >= this.options.minShare ? [{ run, tokens, total }] : [];
    });
    if (heavy.length === 0) return [];

    const byType = new Map<
      string,
      { runs: number; tokens: number; total: number; models: Set<string> }
    >();
    for (const h of heavy) {
      const g = byType.get(h.run.agentType) ?? { runs: 0, tokens: 0, total: 0, models: new Set() };
      g.runs++;
      g.tokens += h.tokens;
      g.total += h.total;
      for (const m of h.run.byModel) g.models.add(m.model);
      byType.set(h.run.agentType, g);
    }
    const top = [...byType]
      .sort((a, b) => b[1].tokens - a[1].tokens)
      .slice(0, this.options.listTop)
      .map(
        ([type, g]) =>
          `${type}: ${g.runs} run${g.runs === 1 ? '' : 's'}, ${compact(g.tokens)} tokens (${percent(g.tokens / g.total)} of their sessions) on ${[...g.models].join(', ')}`,
      );

    return [
      {
        ruleId: this.id,
        severity: 'warn',
        title: `${heavy.length} agent run${heavy.length === 1 ? '' : 's'} used over ${percent(this.options.minShare)} of a session’s tokens`,
        detail: [
          `Subagents start with a fresh context and re-read files the main session may already have, so a broad task can cost more than the conversation that started it.`,
          `Heaviest: ${top.join('; ')}.`,
        ].join(' '),
        actions: [
          'Give the agent a cheaper model: `model: haiku` or `model: sonnet` in its front matter',
          'Hand agents narrow tasks with the file paths they need, not open-ended searches',
          'cclens agents --by session   # see where agent tokens went',
        ],
      },
    ];
  }
}

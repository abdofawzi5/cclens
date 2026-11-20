/*
 * `cclens advise`: one pass over every analysis (review rules, context overhead,
 * unused plugins, recurring jobs, budget) that ranks what to change and suggests
 * skills for the tasks the user repeats. Everything here is pure.
 */
import type { ActionPlan } from './action-plan.js';
import { type Budget, type BudgetStatus, isBudgetSet } from './budget.js';
import type { FixHint } from './fix-hints.js';
import type { Job } from './jobs.js';
import type { OverheadSummary } from './overhead.js';
import { compareRecommendations, type Recommendation } from './recommendation.js';
import type { ReviewSummary } from './review.js';
import type { SearchResult } from './search.js';
import { compact, usd } from '../util/format.js';

/** Skills from the search engines that may take over a task the user keeps repeating. */
export interface SkillSuggestion {
  /** The job the query came from. */
  readonly job: Pick<Job, 'name' | 'kind' | 'runs' | 'monthlyCostUsd'>;
  readonly query: string;
  /** Not yet installed, best first. */
  readonly results: readonly SearchResult[];
}

export interface Advice {
  readonly since: Date;
  readonly until: Date;
  readonly windowDays: number;
  readonly summary: ReviewSummary;
  /** Average tokens sent before the first prompt, when transcripts recorded it. */
  readonly contextTokens?: number;
  /** Every suggestion, most severe and largest saving first. */
  readonly suggestions: readonly Recommendation[];
  /** Commands that stop listing unused plugins and skills (printed, never run). */
  readonly disable: readonly FixHint[];
  /** Skills that might handle repeated tasks; empty when search was skipped. */
  readonly discover: readonly SkillSuggestion[];
  readonly budget: readonly BudgetStatus[];
  /** Structural changes ranked by estimated dollars saved a month; shown last. */
  readonly plan: ActionPlan;
  /** Partial data: sources that failed or were skipped. */
  readonly notes: readonly string[];
}

export interface OverheadAdviceOptions {
  /** Above this average, the whole pre-prompt context gets its own finding. */
  readonly totalWarnTokens: number;
  /** MCP servers whose tool names together cost at least this get a finding. */
  readonly mcpMinTokens: number;
  /** A CLAUDE.md or memory file at least this big gets a finding. */
  readonly instructionFileTokens: number;
  readonly listTop: number;
}

const OVERHEAD_DEFAULTS: OverheadAdviceOptions = {
  totalWarnTokens: 40_000,
  mcpMinTokens: 2_000,
  instructionFileTokens: 3_000,
  listTop: 5,
};

const UUID_LIKE = /^[0-9a-f]{8}-[0-9a-f]{4}-/;

function serverName(server: string): string {
  if (UUID_LIKE.test(server)) return `claude.ai connector ${server.slice(0, 8)}`;
  return server.replace(/^plugin_/, 'plugin ');
}

const shortPath = (p: string): string => p.replace(/^\/(?:Users|home)\/[^/]+/, '~');

/** Findings about what is sent before the first prompt (from `cclens context`). */
export function overheadAdvice(
  overhead: OverheadSummary,
  options: Partial<OverheadAdviceOptions> = {},
): readonly Recommendation[] {
  const o = { ...OVERHEAD_DEFAULTS, ...options };
  const latest = overhead.latest;
  if (overhead.sessions === 0 || !latest) return [];
  const out: Recommendation[] = [];

  const servers = [...latest.mcpServers].sort((a, b) => b.tokens - a.tokens);
  const mcpTokens = servers.reduce((n, s) => n + s.tokens, 0);
  if (mcpTokens >= o.mcpMinTokens) {
    const top = servers
      .slice(0, o.listTop)
      .map((s) => `${serverName(s.server)} (${String(s.tools)} tools, ~${compact(s.tokens)})`);
    out.push({
      ruleId: 'mcp-overhead',
      severity: mcpTokens >= 10_000 ? 'warn' : 'info',
      title: `${String(servers.length)} MCP servers add ~${compact(mcpTokens)} tokens to every request`,
      detail: `Each connected server lists its tools in the context of every request, whether you call them or not. Biggest: ${top.join('; ')}.`,
      estimatedTokenSavings: mcpTokens,
      savingsBasis: 'per-request',
      actions: [
        'cclens context   # tools per MCP server',
        'Disconnect servers you do not use: `claude mcp remove <name>`, or turn off claude.ai connectors and plugin servers in their settings',
        'Keep rarely used servers in a project `.mcp.json` instead of your user config',
      ],
    });
  }

  const bigFiles = latest.instructionFiles
    .filter((f) => f.tokens >= o.instructionFileTokens)
    .sort((a, b) => b.tokens - a.tokens);
  if (bigFiles.length > 0) {
    const tokens = bigFiles.reduce((n, f) => n + f.tokens, 0);
    out.push({
      ruleId: 'large-instructions',
      severity: tokens >= 10_000 ? 'warn' : 'info',
      title: `${String(bigFiles.length)} CLAUDE.md or memory ${bigFiles.length === 1 ? 'file is' : 'files are'} ~${compact(tokens)} tokens`,
      detail: `These load into every session: ${bigFiles
        .slice(0, o.listTop)
        .map((f) => `${shortPath(f.path)} (${f.kind}, ~${compact(f.tokens)})`)
        .join('; ')}. Halving them saves about ${compact(tokens / 2)} tokens per request.`,
      estimatedTokenSavings: Math.round(tokens / 2),
      savingsBasis: 'per-request',
      actions: [
        'Move rarely needed detail into a skill or a doc the file links to; skills load only when used',
        'Delete stale memories and instructions Claude already follows by default',
      ],
    });
  }

  if (overhead.averageTokens >= o.totalWarnTokens) {
    const parts = overhead.parts
      .slice(0, 3)
      .map((p) => `${p.label} ~${compact(p.tokens)}`)
      .join(', ');
    out.push({
      ruleId: 'context-overhead',
      severity: 'info',
      title: `~${compact(overhead.averageTokens)} tokens are sent before your first prompt`,
      detail: `Largest parts: ${parts}. Cache reads make repeats cheap, but every new session and every cache miss pays it in full.`,
      actions: ['cclens context   # the full breakdown'],
    });
  }
  return out;
}

/** A budget nudge: warn when over, suggest one when none is set but spend is real. */
export function budgetAdvice(
  budget: Budget | undefined,
  statuses: readonly BudgetStatus[],
  summary: ReviewSummary,
  windowDays: number,
): readonly Recommendation[] {
  const over = statuses.filter((s) => s.over);
  if (over.length > 0) {
    return [
      {
        ruleId: 'budget',
        severity: 'high',
        title: `Over your ${over.map((s) => s.limit).join(' and ')} budget`,
        detail: over.map((s) => `${s.limit}: ${usd(s.spentUsd)} of ${usd(s.limitUsd)}`).join('; '),
        actions: ['cclens budget', 'Apply the suggestions above before raising the limit'],
      },
    ];
  }
  if (budget && !isBudgetSet(budget) && summary.costUsd > 0) {
    const monthly = (summary.costUsd / Math.max(1, windowDays)) * 30;
    return [
      {
        ruleId: 'budget',
        severity: 'info',
        title: 'No spending limit is set',
        detail: `At the recent pace you spend about ${usd(monthly)} a month (estimate at API list prices). A limit makes Claude Code warn you when a day or month runs over.`,
        actions: [`cclens budget set --monthly ${String(Math.ceil(monthly / 10) * 10)}`],
      },
    ];
  }
  return [];
}

const STOP_WORDS = new Set([
  'a',
  'an',
  'and',
  'the',
  'for',
  'of',
  'to',
  'in',
  'on',
  'with',
  'my',
  'run',
  'daily',
  'weekly',
  'task',
  'job',
  'session',
]);

/**
 * Search words for a job: its name without dates, ids and filler, at most four words.
 * `daily-seo-report-2026-11-19` → `seo report`.
 */
export function jobQuery(name: string): string {
  return name
    .toLowerCase()
    .replace(/\d{4}-\d{2}-\d{2}/g, ' ')
    .replace(/[^\p{L}]+/gu, ' ')
    .split(' ')
    .filter((w) => w.length > 1 && !STOP_WORDS.has(w))
    .slice(0, 4)
    .join(' ');
}

/**
 * Whether a search result is about the query: its name or description must contain most
 * of the query's words (as word starts), so a project-specific job name does not pull in
 * skills that only share one word or none.
 */
export function matchesQuery(
  result: Pick<SearchResult, 'name' | 'description'>,
  query: string,
): boolean {
  const words = query.split(' ').filter(Boolean);
  if (words.length === 0) return false;
  const text = ` ${`${result.name} ${result.description ?? ''}`
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')} `;
  const hits = words.filter((w) => text.includes(` ${w}`)).length;
  return hits >= Math.max(1, Math.ceil(words.length * 0.6));
}

/** Active jobs worth searching a skill for, costliest per month first. */
export function jobsToSearch(jobs: readonly Job[], limit: number): readonly Job[] {
  return jobs
    .filter((j) => j.active && jobQuery(j.name) !== '')
    .sort(
      (a, b) =>
        (b.monthlyCostUsd ?? b.costUsd) - (a.monthlyCostUsd ?? a.costUsd) ||
        b.runs.length - a.runs.length,
    )
    .slice(0, limit);
}

/** Merges findings from every source, drops duplicates by rule id, ranks them. */
export function rankSuggestions(...groups: (readonly Recommendation[])[]): Recommendation[] {
  const seen = new Set<string>();
  const out: Recommendation[] = [];
  for (const r of groups.flat()) {
    const key = `${r.ruleId}:${r.title}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(r);
  }
  return out.sort(compareRecommendations);
}

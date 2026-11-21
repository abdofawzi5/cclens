/*
 * The action plan at the end of `cclens advise`: a few structural changes ranked by
 * estimated dollars saved a month, each tied to a concrete target (a project folder,
 * a recurring job, a file) and spelled out as steps. Built from how each session's
 * model calls went (SessionTurns). Everything here is pure; estimates are rough.
 */
import type { FixHint } from './fix-hints.js';
import type { Job } from './jobs.js';
import type { OverheadSummary } from './overhead.js';
import type { SessionActivity, SessionTurns } from './review.js';
import { SessionLabels } from './session-labels.js';
import type { SessionTokens } from './tokens.js';
import { compact, percent, usd } from '../util/format.js';

export type PlanKind =
  'lean-setup' | 'split-sessions' | 'cheaper-helper' | 'images-in-helper' | 'big-reads';

export interface PlanItem {
  readonly kind: PlanKind;
  readonly title: string;
  /** The project folder or job it applies to. */
  readonly target: string;
  /** The numbers behind it. */
  readonly why: string;
  readonly steps: readonly string[];
  /** Rough dollars saved per 30 days, at API list prices. */
  readonly monthlyUsd: number;
}

export interface ActionPlan {
  /** Biggest saving first. */
  readonly items: readonly PlanItem[];
  readonly monthlyUsd: number;
  /** Items under `minMonthlyUsd` but over `minorMonthlyUsd`, biggest first; not in `monthlyUsd`. */
  readonly smaller: readonly PlanItem[];
}

export interface PlanInput {
  readonly jobs: readonly Job[];
  readonly activity: readonly SessionActivity[];
  readonly sessions: readonly SessionTokens[];
  readonly overhead?: OverheadSummary;
  readonly disable: readonly FixHint[];
  readonly windowDays: number;
}

export interface PlanOptions {
  /** Items saving less than this a month are left out. */
  readonly minMonthlyUsd: number;
  /** Items saving at least this (but under `minMonthlyUsd`) are listed as smaller wins. */
  readonly minorMonthlyUsd: number;
  readonly maxItems: number;
  readonly maxSmaller: number;
  /** A session re-reading at least this many cached tokens is a long one (as the long-sessions rule). */
  readonly longSessionCacheReads: number;
  /** Share of a long session's context growth saved by splitting it into tasks. */
  readonly splitSaving: number;
  /** A job runs at least this many Bash calls per run before a cheaper helper is suggested. */
  readonly minShellCalls: number;
  /** Images read per run before moving the looking to a helper is suggested. */
  readonly minImageReads: number;
  /** A file at least this big, read in at least half the runs, is a big read. */
  readonly bigReadTokens: number;
  /** Rough share of a call's cost saved when a Sonnet helper does it instead of Opus. */
  readonly helperSaving: number;
  /** Tokens one screenshot-sized image adds to the context. */
  readonly imageTokens: number;
}

const DEFAULTS: PlanOptions = {
  minMonthlyUsd: 5,
  minorMonthlyUsd: 1,
  maxItems: 5,
  maxSmaller: 3,
  longSessionCacheReads: 20_000_000,
  splitSaving: 0.5,
  minShellCalls: 15,
  minImageReads: 2,
  bigReadTokens: 4_000,
  helperSaving: 0.5,
  imageTokens: 1_600,
};

const UUID_LIKE = /^[0-9a-f]{8}-[0-9a-f]{4}-/;
const shortPath = (p: string): string => p.replace(/^\/(?:Users|home)\/[^/]+/, '~');
const baseName = (p: string): string => p.split('/').pop() ?? p;
const slug = (s: string): string =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40) || 'helper';

function serverLabel(server: string): string {
  return UUID_LIKE.test(server) ? `claude.ai connector ${server.slice(0, 8)}` : server;
}

/** `claude plugin disable name@market` → `name@market`. */
function pluginKey(h: FixHint): string | undefined {
  if (h.kind !== 'command') return undefined;
  return /plugin disable (\S+)/.exec(h.command)?.[1];
}

interface Averages {
  readonly runs: number;
  readonly calls: number;
  readonly first: number;
  readonly context: number;
  readonly shell: number;
  readonly images: number;
  readonly opus: boolean;
}

function average(turns: readonly SessionTurns[]): Averages | undefined {
  if (turns.length === 0) return undefined;
  const avg = (f: (t: SessionTurns) => number): number =>
    turns.reduce((n, t) => n + f(t), 0) / turns.length;
  const opusCalls = turns.filter((t) => /opus/i.test(t.mainModel ?? '')).length;
  return {
    runs: turns.length,
    calls: avg((t) => t.modelCalls),
    first: avg((t) => t.firstContextTokens),
    context: avg((t) => t.contextTokens),
    shell: avg((t) => t.shellCalls),
    images: avg((t) => t.imageReads),
    opus: opusCalls * 2 >= turns.length,
  };
}

/** Tokens every request carries that unused MCP servers and skills add. */
function removablePerCall(
  overhead: OverheadSummary | undefined,
  disable: readonly FixHint[],
  usedServers: ReadonlySet<string>,
): { tokens: number; servers: readonly { server: string; tokens: number }[] } {
  const latest = overhead?.latest;
  const servers = (latest?.mcpServers ?? [])
    .filter((s) => !usedServers.has(s.server))
    .sort((a, b) => b.tokens - a.tokens);
  const serverTokens = servers.reduce((n, s) => n + s.tokens, 0);
  const allServers = latest?.mcpServers.reduce((n, s) => n + s.tokens, 0) ?? 0;
  // Server instructions shrink with the servers that go.
  const instructions = latest?.parts['mcp-instructions'] ?? 0;
  const instructionTokens = allServers > 0 ? (instructions * serverTokens) / allServers : 0;
  const skillTokens = disable.reduce((n, h) => n + h.group.tokens, 0);
  return {
    tokens: Math.round(serverTokens + instructionTokens + skillTokens),
    servers: servers.map((s) => ({ server: s.server, tokens: s.tokens })),
  };
}

function leanSetup(input: PlanInput, o: PlanOptions): PlanItem[] {
  const cost = new Map(input.sessions.map((s) => [s.sessionId, s.costUsd]));
  const byFolder = new Map<string, SessionActivity[]>();
  for (const a of input.activity) {
    if (!a.turns || !a.cwd) continue;
    const list = byFolder.get(a.cwd) ?? [];
    list.push(a);
    byFolder.set(a.cwd, list);
  }
  const items: PlanItem[] = [];
  for (const [folder, list] of byFolder) {
    const used = new Set(list.flatMap((a) => a.turns?.mcpServersUsed ?? []));
    const removable = removablePerCall(input.overhead, input.disable, used);
    if (removable.tokens <= 0) continue;
    let saved = 0;
    let calls = 0;
    let context = 0;
    for (const a of list) {
      const t = a.turns;
      if (!t || t.contextTokens <= 0) continue;
      const perCall = Math.min(removable.tokens, t.firstContextTokens * 0.8);
      const share = (perCall * t.modelCalls) / t.contextTokens;
      saved += (cost.get(a.sessionId) ?? 0) * share;
      calls += t.modelCalls;
      context += t.contextTokens;
    }
    const monthly = (saved * 30) / Math.max(1, input.windowDays);
    if (monthly < Math.min(o.minMonthlyUsd, o.minorMonthlyUsd)) continue;
    const plugins = input.disable.flatMap((h) => pluginKey(h) ?? []);
    const deny = removable.servers.map((s) => `"mcp__${s.server}"`);
    const settings = `${shortPath(folder)}/.claude/settings.json`;
    const steps = [
      `Add to ${settings} (create it if missing) so sessions in this folder load only what they use:`,
      ...(plugins.length > 0
        ? [
            `  "enabledPlugins": { ${plugins
              .slice(0, 4)
              .map((k) => `"${k}": false`)
              .join(
                ', ',
              )}${plugins.length > 4 ? ', …' : ''} }   # unused plugins (cclens skills --unused --fix lists all)`,
          ]
        : []),
      ...(deny.length > 0
        ? [
            `  "permissions": { "deny": [${deny.slice(0, 3).join(', ')}${deny.length > 3 ? `, … ${String(deny.length - 3)} more` : ''}] }   # MCP servers never called here`,
          ]
        : []),
      'It applies to every session started in that folder, so keep anything you use there by hand.',
    ];
    items.push({
      kind: 'lean-setup',
      title: `Give ${baseName(folder)} a lean setup`,
      target: shortPath(folder),
      why: `${String(list.length)} sessions made ${compact(calls)} model calls here, and each one carried ~${compact(removable.tokens)} tokens of MCP servers and skills that are never used in this folder (${percent((removable.tokens * calls) / Math.max(1, context))} of the context sent).${
        removable.servers[0]
          ? ` Biggest: ${removable.servers
              .slice(0, 3)
              .map((s) => `${serverLabel(s.server)} ~${compact(s.tokens)}`)
              .join(', ')}.`
          : ''
      }`,
      steps,
      monthlyUsd: monthly,
    });
  }
  return items;
}

/**
 * Long hand-started sessions: every call re-sends the conversation so far, so the
 * context grows with each turn. Splitting the work into one session per task cuts
 * that growth; the part every call starts with (firstContextTokens) stays.
 */
function splitSessions(input: PlanInput, o: PlanOptions): PlanItem[] {
  const tokens = new Map(input.sessions.map((s) => [s.sessionId, s]));
  const labels = SessionLabels.from(input.activity);
  const byFolder = new Map<string, { a: SessionActivity; saved: number; reads: number }[]>();
  for (const a of input.activity) {
    const t = a.turns;
    const s = tokens.get(a.sessionId);
    if (!t || !a.cwd || a.scheduledTask || !s || t.contextTokens <= 0) continue;
    if (s.counts.cacheRead < o.longSessionCacheReads) continue;
    const growth = Math.max(0, t.contextTokens - t.modelCalls * t.firstContextTokens);
    const saved = s.costUsd * (growth / t.contextTokens) * o.splitSaving;
    const list = byFolder.get(a.cwd) ?? [];
    list.push({ a, saved, reads: s.counts.cacheRead });
    byFolder.set(a.cwd, list);
  }
  const items: PlanItem[] = [];
  for (const [folder, list] of byFolder) {
    const monthly = (list.reduce((n, x) => n + x.saved, 0) * 30) / Math.max(1, input.windowDays);
    if (monthly <= 0) continue;
    list.sort((x, y) => y.reads - x.reads);
    const compactions = list.reduce((n, x) => n + x.a.autoCompactions, 0);
    const peak = Math.max(...list.map((x) => x.a.turns?.maxContextTokens ?? 0));
    const plural = list.length === 1 ? 'session' : 'sessions';
    items.push({
      kind: 'split-sessions',
      title: `Split long sessions in ${baseName(folder)} into one per task`,
      target: shortPath(folder),
      why: `${String(list.length)} ${plural} here kept going until each call re-sent up to ~${compact(peak)} tokens of conversation${
        compactions > 0
          ? ` (${String(compactions)} auto-compaction${compactions === 1 ? '' : 's'})`
          : ''
      }. Largest: ${list
        .slice(0, 3)
        .map((x) => `${labels.label(x.a.sessionId)} (${compact(x.reads)} cache reads)`)
        .join(', ')}.`,
      steps: [
        'Start a new session (or /clear) when the task changes; a review, a fix and a research question are three sessions',
        `Before ending a long task, have Claude write what to carry over to a short notes file (e.g. ${shortPath(folder)}/docs/notes/<task>.md) and start the next session from it`,
        'Hand wide searches and page-by-page reviews to a subagent (Explore) so only its summary lands in your session',
        'If you must continue, /compact with a focus at a natural break instead of waiting for auto-compaction',
      ],
      monthlyUsd: monthly,
    });
  }
  return items;
}

function jobItems(input: PlanInput, o: PlanOptions): PlanItem[] {
  const byId = new Map(input.activity.map((a) => [a.sessionId, a]));
  const items: PlanItem[] = [];
  for (const job of input.jobs) {
    const monthly = job.monthlyCostUsd ?? 0;
    if (!job.active || monthly < o.minMonthlyUsd) continue;
    const runs = job.runs.flatMap((r) => byId.get(r.sessionId) ?? []);
    const turns = runs.flatMap((a) => a.turns ?? []);
    const avg = average(turns);
    if (!avg || avg.context <= 0) continue;
    const where =
      job.kind === 'scheduled'
        ? `~/.claude/scheduled-tasks/${job.name}/SKILL.md`
        : 'the prompt you start it with';
    const folder = runs.find((a) => a.cwd)?.cwd;
    const agents = folder ? `${shortPath(folder)}/.claude/agents` : '.claude/agents';
    const helper = `${slug(job.name)}-runner`;

    // Mechanical steps on the top model.
    if (avg.opus && avg.shell >= o.minShellCalls) {
      const share = Math.min(0.8, avg.shell / Math.max(1, avg.calls));
      const save = monthly * share * o.helperSaving;
      if (save >= o.minMonthlyUsd) {
        items.push({
          kind: 'cheaper-helper',
          title: `Hand ${job.name}'s mechanical steps to a Sonnet helper`,
          target: job.name,
          why: `Each run makes ~${String(Math.round(avg.calls))} model calls on Opus, ~${String(Math.round(avg.shell))} of them just to run shell commands (builds, scripts, uploads, checks). Scheduled tasks have no model setting, but subagents do.`,
          steps: [
            `Create ${agents}/${helper}.md with front matter \`model: sonnet\` and \`tools: Bash, Read\`, describing the commands it runs and the short report it returns`,
            `In ${where}: keep planning, writing and fixes on the main model, and hand the run/build/upload steps to ${helper}`,
            'Tell it to pipe long output through `tail -20` so its report stays short',
          ],
          monthlyUsd: save,
        });
      }
    }

    // Images that stay in the main context for every later call.
    if (avg.images >= o.minImageReads) {
      const share = Math.min(0.5, (avg.images * o.imageTokens * (avg.calls / 2)) / avg.context);
      const save = monthly * share;
      if (save >= o.minMonthlyUsd) {
        items.push({
          kind: 'images-in-helper',
          title: `Let a helper look at ${job.name}'s images`,
          target: job.name,
          why: `Each run reads ~${String(Math.round(avg.images))} images into the main session, and every later call sends them again (~${compact(o.imageTokens)} tokens each).`,
          steps: [
            `Create ${agents}/${slug(job.name)}-checker.md (\`model: sonnet\`, \`tools: Read, Bash\`) that opens the images and replies "ALL OK" or one line per problem`,
            `In ${where}: never Read images in the main session; send their paths and what each should show to the checker`,
          ],
          monthlyUsd: save,
        });
      }
    }

    // Big files read again on most runs.
    const counts = new Map<string, { runs: number; tokens: number }>();
    for (const t of turns) {
      for (const f of t.fileReads) {
        if (f.tokens < o.bigReadTokens) continue;
        const c = counts.get(f.path) ?? { runs: 0, tokens: 0 };
        counts.set(f.path, { runs: c.runs + 1, tokens: Math.max(c.tokens, f.tokens) });
      }
    }
    const big = [...counts.entries()]
      .filter(([, c]) => c.runs * 2 >= turns.length)
      .sort((a, b) => b[1].tokens - a[1].tokens);
    if (big.length > 0) {
      const tokens = big.reduce((n, [, c]) => n + c.tokens, 0);
      const share = Math.min(0.5, (tokens * 0.7 * (avg.calls / 2)) / avg.context);
      const save = monthly * share;
      if (save >= o.minMonthlyUsd) {
        items.push({
          kind: 'big-reads',
          title: `Stop ${job.name} reading whole big files every run`,
          target: job.name,
          why: `Most runs read ${big
            .slice(0, 3)
            .map(([p, c]) => `${baseName(p)} (~${compact(c.tokens)})`)
            .join(', ')} in full; that text then rides along on every later call.`,
          steps: [
            `In ${where}: \`grep\` or \`tail\` these files for what the run needs instead of reading them whole`,
            'Move parts that grow every run (logs, history tables) into their own file that the task only greps and appends to',
          ],
          monthlyUsd: save,
        });
      }
    }
  }
  return items;
}

/**
 * The ranked action plan. `items` are the changes saving at least `minMonthlyUsd`;
 * the next few under it are kept as `smaller`, so a quiet project still gets a plan.
 */
export function buildActionPlan(input: PlanInput, options: Partial<PlanOptions> = {}): ActionPlan {
  const o = { ...DEFAULTS, ...options };
  const all = [
    ...leanSetup(input, o),
    ...splitSessions(input, o),
    ...jobItems(input, { ...o, minMonthlyUsd: Math.min(o.minMonthlyUsd, o.minorMonthlyUsd) }),
  ].sort((a, b) => b.monthlyUsd - a.monthlyUsd);
  const items = all.filter((i) => i.monthlyUsd >= o.minMonthlyUsd).slice(0, o.maxItems);
  const smaller = all
    .filter((i) => i.monthlyUsd < o.minMonthlyUsd && i.monthlyUsd >= o.minorMonthlyUsd)
    .slice(0, o.maxSmaller);
  return { items, monthlyUsd: items.reduce((n, i) => n + i.monthlyUsd, 0), smaller };
}

/** One line for an item's saving. */
export function planSaving(item: PlanItem): string {
  return `~${usd(item.monthlyUsd)} a month`;
}

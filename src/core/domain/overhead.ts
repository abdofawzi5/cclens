/*
 * Context overhead (PLAN A2): what Claude Code sends before you type anything.
 * The first request's size is exact (its usage); the parts are measured from what the
 * transcript records of them and estimated at ~4 characters per token.
 */

export type OverheadPart =
  | 'system-prompt'
  | 'tool-names'
  | 'mcp-instructions'
  | 'skills'
  | 'agents'
  | 'instructions'
  | 'session'
  | 'unrecorded';

export const OVERHEAD_LABELS: Readonly<Record<OverheadPart, string>> = {
  'system-prompt': 'System prompt',
  'tool-names': 'Deferred tool names',
  'mcp-instructions': 'MCP server instructions',
  skills: 'Skill listing',
  agents: 'Agent listing',
  instructions: 'CLAUDE.md and memory',
  session: 'Session details (env, date, mode)',
  unrecorded: 'Tool definitions and the rest',
};

/** One MCP server's share of the deferred tool names. */
export interface McpServerTools {
  /** Server key from `mcp__<server>__<tool>`. */
  readonly server: string;
  readonly tools: number;
  readonly tokens: number;
  /** One of its tool names, to tell unnamed servers apart. */
  readonly example?: string;
}

export interface InstructionFile {
  readonly path: string;
  /** Claude Code's kind, e.g. `User`, `Project`, `AutoMem`. */
  readonly kind: string;
  readonly tokens: number;
}

/** The context of one session's first request. */
export interface SessionOverhead {
  readonly sessionId: string;
  readonly project: string;
  readonly at: Date;
  /** Exact tokens in the first request (input + cache write + cache read). */
  readonly requestTokens: number;
  /** Estimated tokens of the first prompt itself (not overhead). */
  readonly promptTokens: number;
  /** Estimated tokens per part; `unrecorded` is the exact total minus everything measured. */
  readonly parts: Readonly<Record<OverheadPart, number>>;
  readonly toolNames: number;
  readonly mcpServers: readonly McpServerTools[];
  readonly instructionFiles: readonly InstructionFile[];
  readonly skills?: number;
  /** Tokens per skill id in Claude Code's listing; most are listed by name only. */
  readonly skillListing?: Readonly<Record<string, number>>;
}

export interface OverheadPartSummary {
  readonly part: OverheadPart;
  readonly label: string;
  /** Average tokens per session. */
  readonly tokens: number;
  readonly share: number;
}

export interface OverheadSummary {
  readonly sessions: number;
  /** Average tokens sent before the first prompt. */
  readonly averageTokens: number;
  readonly parts: readonly OverheadPartSummary[];
  /** The most recent session, for per-server and per-file detail. */
  readonly latest?: SessionOverhead;
}

export const OVERHEAD_PARTS: readonly OverheadPart[] = Object.keys(
  OVERHEAD_LABELS,
) as OverheadPart[];

/** Sum of a session's parts: everything sent before the first prompt. */
export function overheadTokens(s: SessionOverhead): number {
  return OVERHEAD_PARTS.reduce((n, p) => n + s.parts[p], 0);
}

/**
 * Builds a session's parts from measured ones: `unrecorded` is what the exact request
 * size leaves after the measured parts and the prompt (never below zero).
 */
export function withUnrecorded(
  requestTokens: number,
  promptTokens: number,
  measured: Partial<Record<OverheadPart, number>>,
): Record<OverheadPart, number> {
  const parts = Object.fromEntries(OVERHEAD_PARTS.map((p) => [p, measured[p] ?? 0])) as Record<
    OverheadPart,
    number
  >;
  const known = OVERHEAD_PARTS.reduce((n, p) => (p === 'unrecorded' ? n : n + parts[p]), 0);
  parts.unrecorded = Math.max(0, requestTokens - promptTokens - known);
  return parts;
}

/** Averages each part over sessions; largest first. */
export function summarizeOverhead(sessions: readonly SessionOverhead[]): OverheadSummary {
  const n = sessions.length;
  const latest = [...sessions].sort((a, b) => b.at.getTime() - a.at.getTime())[0];
  if (n === 0) return { sessions: 0, averageTokens: 0, parts: [] };
  const avg = (p: OverheadPart): number => sessions.reduce((t, s) => t + s.parts[p], 0) / n;
  const averageTokens = sessions.reduce((t, s) => t + overheadTokens(s), 0) / n;
  const parts = OVERHEAD_PARTS.map((part) => {
    const tokens = avg(part);
    return {
      part,
      label: OVERHEAD_LABELS[part],
      tokens,
      share: averageTokens > 0 ? tokens / averageTokens : 0,
    };
  })
    .filter((p) => p.tokens > 0)
    .sort((a, b) => b.tokens - a.tokens);
  return { sessions: n, averageTokens, parts, ...(latest ? { latest } : {}) };
}

/**
 * Splits Claude Code's skill listing (`- id: description` or `- id` per skill) into
 * tokens per skill id.
 */
export function parseSkillListing(content: string): Record<string, number> {
  const out: Record<string, number> = {};
  const body = content.startsWith('- ') ? content.slice(2) : content;
  if (!body.trim()) return out;
  for (const entry of body.split('\n- ')) {
    const colon = entry.indexOf(': ');
    const id = (colon > 0 ? entry.slice(0, colon) : entry).trim();
    if (id) out[id] = (out[id] ?? 0) + Math.ceil((entry.length + 3) / 4);
  }
  return out;
}

/** The listing from the most recent session that recorded one. */
export function latestSkillListing(
  sessions: readonly SessionOverhead[],
): Readonly<Record<string, number>> | undefined {
  return [...sessions]
    .filter((s) => s.skillListing && Object.keys(s.skillListing).length > 0)
    .sort((a, b) => b.at.getTime() - a.at.getTime())[0]?.skillListing;
}

/** `mcp__plugin_x_gmail__send` → `plugin_x_gmail`; undefined for non-MCP tools. */
export function mcpServerOf(toolName: string): string | undefined {
  if (!toolName.startsWith('mcp__')) return undefined;
  const rest = toolName.slice(5);
  const end = rest.indexOf('__');
  return end > 0 ? rest.slice(0, end) : undefined;
}

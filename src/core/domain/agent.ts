import type { TokenCounts } from './tokens.js';

/** Where an installed agent comes from. */
export type AgentScope = 'personal' | 'project' | 'plugin';

/** An installed subagent definition (`agents/<name>.md`). */
export interface Agent {
  /** The `subagent_type` Claude Code uses: `plugin:name`, or just `name`. */
  readonly id: string;
  readonly name: string;
  readonly scope: AgentScope;
  readonly plugin?: string;
  readonly description?: string;
  /** Model the agent asks for in its front matter (`sonnet`, `haiku`, `inherit`…). */
  readonly model?: string;
  readonly path?: string;
}

/** Agents that ship with Claude Code; never reported as unused or uninstallable. */
export const BUILTIN_AGENT_TYPES: ReadonlySet<string> = new Set([
  'general-purpose',
  'Explore',
  'Plan',
  'statusline-setup',
  'claude-code-guide',
  'claude',
]);

export interface ModelTokens {
  readonly model: string;
  readonly counts: TokenCounts;
}

/** One subagent run, read from its own transcript. */
export interface AgentRun {
  readonly sessionId: string;
  readonly project: string;
  readonly agentId: string;
  /** `subagent_type`, e.g. `general-purpose` or `pr-review-toolkit:code-reviewer`. */
  readonly agentType: string;
  readonly start: Date;
  readonly end: Date;
  readonly counts: TokenCounts;
  /** Tokens per model; subagents often run on a different model than the session. */
  readonly byModel: readonly ModelTokens[];
}

/** Subagent runs, plus every Agent tool call (including ones that failed to start). */
export interface AgentActivity {
  readonly runs: readonly AgentRun[];
  /** Agent tool calls per `subagent_type`. */
  readonly calls: ReadonlyMap<string, number>;
}

/** USD per token, as in the LiteLLM price list ccusage uses. */
export interface ModelPrice {
  readonly input: number;
  readonly output: number;
  readonly cacheCreation: number;
  readonly cacheRead: number;
}

export function costOf(counts: TokenCounts, price: ModelPrice): number {
  return (
    counts.input * price.input +
    counts.output * price.output +
    counts.cacheCreation * price.cacheCreation +
    counts.cacheRead * price.cacheRead
  );
}

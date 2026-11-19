import type { Agent, AgentActivity, ModelPrice } from '../domain/agent.js';

/** One place agents are installed (personal dir, project dir, plugins). */
export interface AgentSource {
  readonly id: string;
  list(): Promise<readonly Agent[]>;
}

/** Subagent runs and Agent tool calls from transcripts. */
export interface AgentActivitySource {
  read(since?: Date): Promise<AgentActivity>;
}

/** Per-token model prices; `undefined` for a model it does not know. */
export interface PriceTable {
  price(model: string): ModelPrice | undefined;
}

export interface PriceList {
  /** Throws when no price list can be loaded (offline with an empty cache). */
  load(): Promise<PriceTable>;
}

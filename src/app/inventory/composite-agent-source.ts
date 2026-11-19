import type { Agent } from '../../core/domain/agent.js';
import type { AgentSource } from '../../core/ports/agents.js';

/** Composite: many sources behave as one. The first source to report an id wins. */
export class CompositeAgentSource implements AgentSource {
  readonly id = 'all';

  constructor(private readonly sources: readonly AgentSource[]) {}

  async list(): Promise<readonly Agent[]> {
    const lists = await Promise.all(this.sources.map((s) => s.list()));
    const byId = new Map<string, Agent>();
    for (const agent of lists.flat()) if (!byId.has(agent.id)) byId.set(agent.id, agent);
    return [...byId.values()];
  }
}

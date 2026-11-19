import { join } from 'node:path';
import type { Agent, AgentScope } from '../../../core/domain/agent.js';
import type { AgentSource } from '../../../core/ports/agents.js';
import { findPlugins } from '../plugins/plugin-dirs.js';
import { readAgentsDir } from './read-agents-dir.js';

/** Standalone agents in one folder: `~/.claude/agents` (personal) or `.claude/agents` (project). */
export class AgentDirSource implements AgentSource {
  constructor(
    readonly id: string,
    private readonly dir: string,
    private readonly scope: Exclude<AgentScope, 'plugin'>,
  ) {}

  list(): Promise<readonly Agent[]> {
    return readAgentsDir(this.dir, this.scope);
  }
}

/** Agents of every installed plugin under the given roots (`agents/<name>.md`). */
export class PluginAgentSource implements AgentSource {
  readonly id = 'plugins';

  constructor(
    private readonly roots: readonly string[],
    private readonly maxDepth = 6,
  ) {}

  async list(): Promise<readonly Agent[]> {
    const byId = new Map<string, Agent>();
    for await (const plugin of findPlugins(this.roots, this.maxDepth)) {
      for (const agent of await readAgentsDir(join(plugin.dir, 'agents'), 'plugin', plugin.name)) {
        if (!byId.has(agent.id)) byId.set(agent.id, agent);
      }
    }
    return [...byId.values()].sort((a, b) => a.id.localeCompare(b.id));
  }
}

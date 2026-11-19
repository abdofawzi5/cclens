import { readdir, readFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import type { Agent, AgentScope } from '../../../core/domain/agent.js';
import { qualifySkillId } from '../../../core/domain/skill.js';
import { parseSkillFrontmatter } from '../skills/frontmatter.js';

/** Lists `<dir>/*.md` agent definitions. Missing dir → empty list. */
export async function readAgentsDir(
  dir: string,
  scope: AgentScope,
  plugin?: string,
): Promise<Agent[]> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const agents: Agent[] = [];
  for (const entry of entries) {
    if (!entry.name.endsWith('.md') || entry.isDirectory()) continue;
    const path = join(dir, entry.name);
    let text: string;
    try {
      text = await readFile(path, 'utf8');
    } catch {
      continue;
    }
    const meta = parseSkillFrontmatter(text);
    const name = meta.name ?? basename(entry.name, '.md');
    agents.push({
      id: qualifySkillId(name, plugin),
      name,
      scope,
      path,
      ...(plugin === undefined ? {} : { plugin }),
      ...(meta.description === undefined ? {} : { description: meta.description }),
      ...(meta.model === undefined ? {} : { model: meta.model }),
    });
  }
  return agents.sort((a, b) => a.id.localeCompare(b.id));
}

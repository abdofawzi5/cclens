import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { qualifySkillId, type Skill, type SkillScope } from '../../../core/domain/skill.js';
import { parseSkillFrontmatter } from './frontmatter.js';

/** Lists `<dir>/<skill>/SKILL.md` entries as skills. Missing dir → empty list. */
export async function readSkillsDir(
  dir: string,
  scope: SkillScope,
  plugin?: string,
): Promise<Skill[]> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const skills: Skill[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
    const path = join(dir, entry.name, 'SKILL.md');
    let text: string;
    try {
      text = await readFile(path, 'utf8');
    } catch {
      continue;
    }
    const meta = parseSkillFrontmatter(text);
    const name = meta.name ?? entry.name;
    skills.push({
      id: qualifySkillId(name, plugin),
      name,
      scope,
      path,
      ...(plugin === undefined ? {} : { plugin }),
      ...(meta.description === undefined ? {} : { description: meta.description }),
    });
  }
  return skills.sort((a, b) => a.id.localeCompare(b.id));
}

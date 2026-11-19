import { parse } from 'yaml';

export interface SkillFrontmatter {
  readonly name?: string;
  readonly description?: string;
}

const BLOCK = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/;

/** Reads `name` and `description` from a SKILL.md YAML front matter block. Never throws. */
export function parseSkillFrontmatter(markdown: string): SkillFrontmatter {
  const block = BLOCK.exec(markdown)?.[1];
  if (!block) return {};
  try {
    const data: unknown = parse(block);
    if (!data || typeof data !== 'object') return {};
    const { name, description } = data as Record<string, unknown>;
    return {
      ...(typeof name === 'string' && name.trim() ? { name: name.trim() } : {}),
      ...(typeof description === 'string' && description.trim()
        ? { description: description.trim().replace(/\s+/g, ' ') }
        : {}),
    };
  } catch {
    return {};
  }
}

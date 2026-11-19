import { parse } from 'yaml';

export interface SkillFrontmatter {
  readonly name?: string;
  readonly description?: string;
  /** Agents only: the model the agent asks for. */
  readonly model?: string;
}

const BLOCK = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/;

/** Reads `name`, `description` (and an agent's `model`) from YAML front matter. Never throws. */
export function parseSkillFrontmatter(markdown: string): SkillFrontmatter {
  const block = BLOCK.exec(markdown)?.[1];
  if (!block) return {};
  try {
    const data: unknown = parse(block);
    if (!data || typeof data !== 'object') return {};
    const { name, description, model } = data as Record<string, unknown>;
    return {
      ...(typeof name === 'string' && name.trim() ? { name: name.trim() } : {}),
      ...(typeof description === 'string' && description.trim()
        ? { description: description.trim().replace(/\s+/g, ' ') }
        : {}),
      ...(typeof model === 'string' && model.trim() ? { model: model.trim() } : {}),
    };
  } catch {
    return {};
  }
}

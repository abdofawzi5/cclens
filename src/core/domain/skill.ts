/** Where an installed skill comes from. */
export type SkillScope = 'personal' | 'project' | 'plugin' | 'builtin';

/** An installed skill, as seen by Claude Code. */
export interface Skill {
  /** Qualified name used by Claude Code, e.g. `marketing:seo-audit` or `write-article`. */
  readonly id: string;
  readonly name: string;
  readonly scope: SkillScope;
  /** Plugin that ships the skill, when `scope` is `plugin`. */
  readonly plugin?: string;
  readonly description?: string;
  /** Absolute path to the skill's `SKILL.md`, when known. */
  readonly path?: string;
}

/** Builds the qualified id Claude Code uses: `plugin:name`, or just `name`. */
export function qualifySkillId(name: string, plugin?: string): string {
  return plugin ? `${plugin}:${name}` : name;
}

/** Splits a qualified id back into its plugin and name parts. */
export function parseSkillId(id: string): { plugin?: string; name: string } {
  const idx = id.indexOf(':');
  if (idx <= 0 || idx === id.length - 1) return { name: id };
  return { plugin: id.slice(0, idx), name: id.slice(idx + 1) };
}

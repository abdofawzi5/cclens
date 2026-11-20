import { join } from 'node:path';
import type { Skill } from '../../../core/domain/skill.js';
import type { SkillSource } from '../../../core/ports/skills.js';
import { findPlugins } from '../plugins/plugin-dirs.js';
import { readSkillsDir } from './read-skills-dir.js';

/**
 * Skills of every installed plugin under the given roots (`skills/<name>/SKILL.md`),
 * except plugins turned off in settings.
 * The same plugin found in several places is listed once.
 */
export class PluginTreeSource implements SkillSource {
  readonly id = 'plugins';

  constructor(
    private readonly roots: readonly string[],
    private readonly maxDepth = 6,
    /** Names of plugins turned off in settings; their skills are left out. */
    private readonly disabled: () => Promise<ReadonlySet<string>> = () =>
      Promise.resolve(new Set()),
  ) {}

  async list(): Promise<readonly Skill[]> {
    const byId = new Map<string, Skill>();
    const disabled = await this.disabled();
    for await (const plugin of findPlugins(this.roots, this.maxDepth)) {
      if (disabled.has(plugin.name)) continue;
      for (const skill of await readSkillsDir(join(plugin.dir, 'skills'), 'plugin', plugin.name)) {
        if (!byId.has(skill.id)) byId.set(skill.id, skill);
      }
    }
    return [...byId.values()].sort((a, b) => a.id.localeCompare(b.id));
  }
}

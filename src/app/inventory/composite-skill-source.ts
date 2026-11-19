import type { Skill } from '../../core/domain/skill.js';
import type { SkillSource } from '../../core/ports/skills.js';

/** Composite: many sources behave as one. The first source to report an id wins. */
export class CompositeSkillSource implements SkillSource {
  readonly id = 'all';

  constructor(private readonly sources: readonly SkillSource[]) {}

  async list(): Promise<readonly Skill[]> {
    const lists = await Promise.all(this.sources.map((s) => s.list()));
    const byId = new Map<string, Skill>();
    for (const skill of lists.flat()) if (!byId.has(skill.id)) byId.set(skill.id, skill);
    return [...byId.values()];
  }
}

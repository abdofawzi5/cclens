import type { Skill, SkillScope } from '../../../core/domain/skill.js';
import type { SkillSource } from '../../../core/ports/skills.js';
import { readSkillsDir } from './read-skills-dir.js';

/** Standalone skills in one folder: `~/.claude/skills` (personal) or `.claude/skills` (project). */
export class SkillDirSource implements SkillSource {
  constructor(
    readonly id: string,
    private readonly dir: string,
    private readonly scope: Extract<SkillScope, 'personal' | 'project'>,
  ) {}

  list(): Promise<readonly Skill[]> {
    return readSkillsDir(this.dir, this.scope);
  }
}

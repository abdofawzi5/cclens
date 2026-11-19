import type { Skill } from '../domain/skill.js';

/** One place skills are installed (personal dir, project dir, a plugin store…). */
export interface SkillSource {
  readonly id: string;
  list(): Promise<readonly Skill[]>;
}

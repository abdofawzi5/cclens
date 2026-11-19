import type { Skill } from './skill.js';
import type { SessionTokens, TokenBucket, UsageBlock } from './tokens.js';

/** Tokens loaded into context before the user types anything, by category. */
export interface ContextOverhead {
  readonly mcpTools?: number;
  readonly skills?: number;
  readonly systemPrompt?: number;
  readonly memory?: number;
}

/** Everything a rule may look at. Built once per review by the ReviewService. */
export interface ReviewContext {
  readonly now: Date;
  readonly windowDays: number;
  readonly installedSkills: readonly Skill[];
  /** Uses per qualified skill id inside the review window. */
  readonly skillUseCounts: ReadonlyMap<string, number>;
  readonly daily: readonly TokenBucket[];
  readonly sessions: readonly SessionTokens[];
  readonly blocks: readonly UsageBlock[];
  readonly overhead?: ContextOverhead;
}

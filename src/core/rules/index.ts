import type { OptimizationRule } from '../ports/review.js';
import { CacheChurnRule } from './cache-churn.js';
import { FrequentCompactionRule } from './frequent-compaction.js';
import { LongSessionsRule } from './long-sessions.js';
import { ModelMixRule } from './model-mix.js';
import { UnusedSkillsRule } from './unused-skills.js';
import { UsageSpikesRule } from './usage-spikes.js';

export type { SkillGroup } from './unused-skills.js';
export { CacheChurnRule } from './cache-churn.js';
export { FrequentCompactionRule } from './frequent-compaction.js';
export { LongSessionsRule } from './long-sessions.js';
export { ModelMixRule } from './model-mix.js';
export { skillGroups, skillListingTokens, UnusedSkillsRule } from './unused-skills.js';
export { UsageSpikesRule } from './usage-spikes.js';

/** The built-in rule set, with default thresholds. */
export function defaultRules(): readonly OptimizationRule[] {
  return [
    new UnusedSkillsRule(),
    new LongSessionsRule(),
    new FrequentCompactionRule(),
    new CacheChurnRule(),
    new ModelMixRule(),
    new UsageSpikesRule(),
  ];
}

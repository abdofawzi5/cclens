import type { ReviewContext, SessionActivity } from '../../src/core/domain/review.js';
import type {
  ModelUsage,
  SessionTokens,
  TokenBucket,
  TokenCounts,
} from '../../src/core/domain/tokens.js';

export const counts = (p: Partial<TokenCounts> = {}): TokenCounts => ({
  input: 0,
  output: 0,
  cacheCreation: 0,
  cacheRead: 0,
  ...p,
});

export function day(period: string, c: Partial<TokenCounts>, byModel?: ModelUsage[]): TokenBucket {
  return {
    period,
    counts: counts(c),
    costUsd: byModel ? byModel.reduce((n, m) => n + m.costUsd, 0) : 1,
    models: byModel?.map((m) => m.model) ?? [],
    ...(byModel ? { byModel } : {}),
  };
}

export function session(
  sessionId: string,
  c: Partial<TokenCounts>,
  last = '2026-11-19T10:00:00Z',
): SessionTokens {
  return {
    sessionId,
    project: '-Users-me-Workspace-site',
    firstActivity: new Date('2026-11-19T08:00:00Z'),
    lastActivity: new Date(last),
    counts: counts(c),
    costUsd: 2,
    models: ['claude-opus-5-5'],
  };
}

export function activity(sessionId: string, p: Partial<SessionActivity> = {}): SessionActivity {
  return {
    sessionId,
    project: '-Users-me-Workspace-site',
    firstActivity: new Date('2026-11-19T08:00:00Z'),
    lastActivity: new Date('2026-11-19T10:00:00Z'),
    prompts: 3,
    autoCompactions: 0,
    manualCompactions: 0,
    ...p,
  };
}

/** A quiet window context; override the parts a test cares about. */
export function reviewContext(p: Partial<ReviewContext> = {}): ReviewContext {
  return {
    now: new Date('2026-11-19T12:00:00Z'),
    scope: { kind: 'window' },
    since: new Date('2026-10-21T00:00:00Z'),
    windowDays: 30,
    installedSkills: [],
    skillUseCounts: new Map(),
    daily: [],
    sessions: [],
    activity: [],
    installedAgents: [],
    agentCalls: new Map(),
    agentRuns: [],
    ...p,
  };
}

import type {
  Period,
  ProjectTokens,
  SessionTokens,
  TokenBucket,
  UsageBlock,
} from '../../src/core/domain/tokens.js';
import type { TokenUsageProvider } from '../../src/core/ports/tokens.js';

const c = (n: number) => ({ input: n, output: n, cacheCreation: n, cacheRead: n });

/** Deterministic TokenUsageProvider for service and CLI tests. */
export class FakeTokens implements TokenUsageProvider {
  byPeriod(period: Period): Promise<readonly TokenBucket[]> {
    const label = period === 'day' ? ['2026-11-18', '2026-11-19'] : ['p1', 'p2'];
    return Promise.resolve(
      label.map((period, i) => ({ period, counts: c(i + 1), costUsd: i + 1, models: ['m'] })),
    );
  }

  bySession(): Promise<readonly SessionTokens[]> {
    const s = (sessionId: string, cost: number): SessionTokens => ({
      sessionId,
      project: '-Users-me-Workspace-site',
      firstActivity: new Date('2026-11-19T08:00:00Z'),
      lastActivity: new Date('2026-11-19T09:00:00Z'),
      counts: c(cost),
      costUsd: cost,
      models: ['m'],
    });
    return Promise.resolve([s('cheap', 1), s('expensive', 9)]);
  }

  byProject(): Promise<readonly ProjectTokens[]> {
    return Promise.resolve([{ project: '-Users-me-Workspace-site', counts: c(5), costUsd: 5 }]);
  }

  blocks(): Promise<readonly UsageBlock[]> {
    return Promise.resolve([
      {
        start: new Date('2026-11-19T14:00:00Z'),
        end: new Date('2026-11-19T19:00:00Z'),
        isActive: true,
        counts: c(3),
        costUsd: 3,
      },
    ]);
  }
}

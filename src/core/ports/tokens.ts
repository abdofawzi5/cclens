import type {
  Period,
  SessionTokens,
  TokenBucket,
  TokenFilter,
  UsageBlock,
} from '../domain/tokens.js';

/** Token and cost aggregation. Implemented on top of ccusage. */
export interface TokenUsageProvider {
  byPeriod(period: Period, filter?: TokenFilter): Promise<readonly TokenBucket[]>;
  bySession(filter?: TokenFilter): Promise<readonly SessionTokens[]>;
  blocks(filter?: TokenFilter): Promise<readonly UsageBlock[]>;
}

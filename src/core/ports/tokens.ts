import type {
  Period,
  ProjectTokens,
  SessionTokens,
  TokenBucket,
  TokenFilter,
  UsageBlock,
} from '../domain/tokens.js';

/** Token and cost aggregation. Implemented on top of ccusage. */
export interface TokenUsageProvider {
  byPeriod(period: Period, filter?: TokenFilter): Promise<readonly TokenBucket[]>;
  bySession(filter?: TokenFilter): Promise<readonly SessionTokens[]>;
  byProject(filter?: TokenFilter): Promise<readonly ProjectTokens[]>;
  blocks(filter?: TokenFilter): Promise<readonly UsageBlock[]>;
}

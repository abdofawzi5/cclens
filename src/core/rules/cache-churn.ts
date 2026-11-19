import type { Recommendation, Severity } from '../domain/recommendation.js';
import type { ReviewContext } from '../domain/review.js';
import { addTokens, ZERO_TOKENS, type TokenCounts } from '../domain/tokens.js';
import type { OptimizationRule } from '../ports/review.js';
import { compact, percent } from '../util/format.js';

export interface CacheChurnOptions {
  /** Flag when cache writes exceed this share of all cached tokens. */
  readonly maxWriteShare: number;
  /** Ignore tiny samples. */
  readonly minCachedTokens: number;
}

const DEFAULTS: CacheChurnOptions = { maxWriteShare: 0.1, minCachedTokens: 1_000_000 };

/**
 * Prompt caching pays off when the same prefix is read many times. A high share
 * of cache writes means the cache is rebuilt often and the savings are lost.
 */
export class CacheChurnRule implements OptimizationRule {
  readonly id = 'cache-churn';
  readonly description = 'Prompt cache rebuilt often instead of reused';
  readonly defaultSeverity: Severity = 'warn';
  readonly appliesTo = ['window', 'session'] as const;
  private readonly options: CacheChurnOptions;

  constructor(options: Partial<CacheChurnOptions> = {}) {
    this.options = { ...DEFAULTS, ...options };
  }

  evaluate(ctx: ReviewContext): readonly Recommendation[] {
    const rows: readonly { counts: TokenCounts }[] =
      ctx.scope.kind === 'session' ? ctx.sessions : ctx.daily;
    const t = rows.reduce<TokenCounts>((acc, r) => addTokens(acc, r.counts), ZERO_TOKENS);
    const cached = t.cacheCreation + t.cacheRead;
    if (cached < this.options.minCachedTokens) return [];
    const share = t.cacheCreation / cached;
    if (share <= this.options.maxWriteShare) return [];

    // Writing what could have been read: the excess over the healthy share.
    const excess = Math.round(t.cacheCreation - cached * this.options.maxWriteShare);
    return [
      {
        ruleId: this.id,
        severity: this.defaultSeverity,
        title: `Cache writes are ${percent(share)} of cached tokens`,
        detail:
          `${compact(t.cacheCreation)} tokens were written to the prompt cache and ${compact(t.cacheRead)} read from it. ` +
          'Writes cost more than plain input and reads far less, so a healthy session mostly reads. ' +
          'Common causes: long pauses that let the cache expire, switching models mid-session, ' +
          'and editing CLAUDE.md, settings or MCP servers during a session.',
        estimatedTokenSavings: excess,
        savingsBasis: 'window',
        actions: [
          'Finish a task before long breaks, or start a new session after one',
          'Pick the model at the start of a session and keep it',
          'Change CLAUDE.md, settings and MCP servers between sessions, not during them',
        ],
      },
    ];
  }
}

import {
  type Budget,
  type BudgetStatus,
  budgetStatus,
  isBudgetSet,
  pendingWarnings,
  ROLLUP_MAX_AGE_MS,
  type SpendRollup,
  warningLine,
} from '../core/domain/budget.js';
import { ValidationError } from '../core/errors.js';
import type { BackgroundRunner, Clock, SpendRollupStore } from '../core/ports/infrastructure.js';
import type { TokenUsageProvider } from '../core/ports/tokens.js';
import { localDay } from '../core/util/format.js';
import type { ConfigService } from './config-service.js';
import type { UsageService } from './usage-service.js';

export interface BudgetDeps {
  readonly config: ConfigService;
  readonly store: SpendRollupStore;
  readonly tokens: TokenUsageProvider;
  readonly usage: UsageService;
  readonly clock: Clock;
  readonly background?: BackgroundRunner;
}

export interface BudgetChange {
  readonly daily?: number;
  readonly monthly?: number;
  readonly warnAt?: number;
}

export interface BudgetView {
  readonly budget: Budget;
  readonly rollup?: SpendRollup;
  readonly statuses: readonly BudgetStatus[];
}

/** The command `budget refresh` runs in the background. */
export const REFRESH_ARGS = ['budget', 'refresh'] as const;

/**
 * Budget warnings (PLAN Phase 10): limits in config, spend in a small rollup file
 * that the hook and status line read instead of running ccusage, refreshed in the
 * background when it is older than ten minutes.
 */
export class BudgetService {
  constructor(private readonly deps: BudgetDeps) {}

  async budget(): Promise<Budget> {
    return (await this.deps.config.load()).budget;
  }

  async set(change: BudgetChange): Promise<Budget> {
    if (change.daily === undefined && change.monthly === undefined && change.warnAt === undefined) {
      throw new ValidationError('Give --daily, --monthly or --warn-at.');
    }
    const config = await this.deps.config.load();
    const budget = { ...config.budget, ...change };
    await this.deps.config.save({ ...config, budget });
    return budget;
  }

  async clear(): Promise<void> {
    const config = await this.deps.config.load();
    await this.deps.config.save({ ...config, budget: { warnAt: config.budget.warnAt } });
  }

  /** Recomputes today's and this month's spend from ccusage, keeping the warned-on days. */
  async refresh(): Promise<SpendRollup> {
    const now = this.deps.clock.now();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const day = localDay(now);
    const [buckets, uses] = await Promise.all([
      this.deps.tokens.byPeriod('day', { since: monthStart }),
      this.deps.usage.total({ since: dayStart }).catch(() => 0),
    ]);
    const previous = await this.deps.store.read();
    const rollup: SpendRollup = {
      updatedAt: now,
      day,
      month: day.slice(0, 7),
      todayUsd: buckets.filter((b) => b.period === day).reduce((n, b) => n + b.costUsd, 0),
      monthUsd: buckets
        .filter((b) => b.period.startsWith(day.slice(0, 7)))
        .reduce((n, b) => n + b.costUsd, 0),
      skillUsesToday: uses,
      warned: previous?.warned ?? {},
    };
    await this.deps.store.write(rollup);
    return rollup;
  }

  /** `budget show`: refreshes first so the numbers are current. */
  async show(): Promise<BudgetView> {
    const [budget, rollup] = await Promise.all([this.budget(), this.refresh()]);
    return {
      budget,
      rollup,
      statuses: budgetStatus(budget, rollup, localDay(this.deps.clock.now())),
    };
  }

  /**
   * For the UserPromptSubmit hook: one warning line when a limit is newly passed
   * today, else undefined. Reads two small files; never runs ccusage itself.
   */
  async hookWarning(): Promise<string | undefined> {
    const budget = await this.budget();
    if (!isBudgetSet(budget)) return undefined;
    const now = this.deps.clock.now();
    const rollup = await this.deps.store.read();
    if (!rollup || now.getTime() - rollup.updatedAt.getTime() > ROLLUP_MAX_AGE_MS) {
      this.deps.background?.start(REFRESH_ARGS);
    }
    const day = localDay(now);
    const pending = pendingWarnings(budget, rollup, day);
    if (!rollup || pending.length === 0) return undefined;
    const warned = { ...rollup.warned };
    for (const s of pending) warned[s.limit] = day;
    await this.deps.store.write({ ...rollup, warned });
    return warningLine(pending);
  }
}

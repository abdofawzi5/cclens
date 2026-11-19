/** Spending limits in USD (estimated at API list prices), from `config.budget`. */
export interface Budget {
  readonly daily?: number | undefined;
  readonly monthly?: number | undefined;
  /** Warn at this percent of a limit (100 = when it is passed). */
  readonly warnAt: number;
}

export type BudgetLimit = 'daily' | 'monthly';

/**
 * A small snapshot of spend that the hook and status line can read in a few
 * milliseconds, instead of running ccusage. Refreshed in the background.
 */
export interface SpendRollup {
  readonly updatedAt: Date;
  /** Local day (`YYYY-MM-DD`) and month (`YYYY-MM`) the totals belong to. */
  readonly day: string;
  readonly month: string;
  readonly todayUsd: number;
  readonly monthUsd: number;
  readonly skillUsesToday: number;
  /** Day each limit last warned, so a warning shows at most once per limit per day. */
  readonly warned: Partial<Record<BudgetLimit, string>>;
}

export interface BudgetStatus {
  readonly limit: BudgetLimit;
  readonly spentUsd: number;
  readonly limitUsd: number;
  /** spent / limit. */
  readonly fraction: number;
  /** At or over the warn threshold. */
  readonly over: boolean;
}

/** Rollups older than this are refreshed in the background. */
export const ROLLUP_MAX_AGE_MS = 10 * 60_000;

export function isBudgetSet(budget: Budget): boolean {
  return budget.daily !== undefined || budget.monthly !== undefined;
}

/** Spend against each limit that is set. Totals from another day or month count as zero. */
export function budgetStatus(
  budget: Budget,
  rollup: SpendRollup | undefined,
  day: string,
): readonly BudgetStatus[] {
  const month = day.slice(0, 7);
  const today = rollup?.day === day ? rollup.todayUsd : 0;
  const thisMonth = rollup?.month === month ? rollup.monthUsd : 0;
  const statuses: BudgetStatus[] = [];
  const add = (limit: BudgetLimit, spentUsd: number, limitUsd: number | undefined): void => {
    if (limitUsd === undefined || limitUsd <= 0) return;
    const fraction = spentUsd / limitUsd;
    statuses.push({ limit, spentUsd, limitUsd, fraction, over: fraction * 100 >= budget.warnAt });
  };
  add('daily', today, budget.daily);
  add('monthly', thisMonth, budget.monthly);
  return statuses;
}

/** Limits over their threshold that have not warned yet today. */
export function pendingWarnings(
  budget: Budget,
  rollup: SpendRollup | undefined,
  day: string,
): readonly BudgetStatus[] {
  return budgetStatus(budget, rollup, day).filter((s) => s.over && rollup?.warned[s.limit] !== day);
}

/** `cclens: today's estimated cost is $71 (daily budget $50)`. */
export function warningLine(statuses: readonly BudgetStatus[]): string {
  const parts = statuses.map((s) =>
    s.limit === 'daily'
      ? `today's estimated cost is ${money(s.spentUsd)} (daily budget ${money(s.limitUsd)})`
      : `this month's estimated cost is ${money(s.spentUsd)} (monthly budget ${money(s.limitUsd)})`,
  );
  return `cclens: ${parts.join('; ')}`;
}

/** Whole dollars from $10 up, cents below. */
export function money(n: number): string {
  return Math.abs(n) >= 10 ? `$${Math.round(n).toLocaleString('en-US')}` : `$${n.toFixed(2)}`;
}

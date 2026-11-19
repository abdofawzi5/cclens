import { describe, expect, it } from 'vitest';
import {
  budgetStatus,
  isBudgetSet,
  money,
  pendingWarnings,
  warningLine,
} from '../../../src/core/domain/budget.js';
import { defaultConfig } from '../../../src/core/config/defaults.js';
import { parseConfig } from '../../../src/core/config/parse.js';
import { rollup } from '../../support/budget.js';

const day = '2026-11-19';

describe('budget domain', () => {
  it('defaults to no limits, warning when a limit is passed', () => {
    const { budget } = defaultConfig();
    expect(budget).toEqual({ warnAt: 100 });
    expect(isBudgetSet(budget)).toBe(false);
    expect(() => parseConfig({ ...defaultConfig(), budget: { daily: -1 } })).toThrow();
  });

  it('compares spend with each limit set, ignoring another day or month', () => {
    const budget = { daily: 50, monthly: 800, warnAt: 100 };
    expect(budgetStatus(budget, rollup(), day)).toEqual([
      { limit: 'daily', spentUsd: 71, limitUsd: 50, fraction: 1.42, over: true },
      { limit: 'monthly', spentUsd: 300, limitUsd: 800, fraction: 0.375, over: false },
    ]);
    const stale = rollup({ day: '2026-11-18', month: '2026-10' });
    expect(budgetStatus(budget, stale, day).map((s) => s.spentUsd)).toEqual([0, 0]);
    expect(budgetStatus({ warnAt: 100 }, rollup(), day)).toEqual([]);
  });

  it('warns at a lower percent when asked', () => {
    const budget = { monthly: 400, warnAt: 75 };
    expect(budgetStatus(budget, rollup(), day)[0]?.over).toBe(true);
  });

  it('warns once per limit per day', () => {
    const budget = { daily: 50, monthly: 200, warnAt: 100 };
    expect(pendingWarnings(budget, rollup(), day).map((s) => s.limit)).toEqual([
      'daily',
      'monthly',
    ]);
    const warned = rollup({ warned: { daily: day, monthly: '2026-11-18' } });
    expect(pendingWarnings(budget, warned, day).map((s) => s.limit)).toEqual(['monthly']);
    expect(pendingWarnings(budget, undefined, day)).toEqual([]);
  });

  it('says "estimated" in the warning line', () => {
    const budget = { daily: 50, monthly: 200, warnAt: 100 };
    expect(warningLine(budgetStatus(budget, rollup(), day))).toBe(
      "cclens: today's estimated cost is $71 (daily budget $50); this month's estimated cost is $300 (monthly budget $200)",
    );
    expect(money(4.5)).toBe('$4.50');
    expect(money(1234.4)).toBe('$1,234');
  });
});

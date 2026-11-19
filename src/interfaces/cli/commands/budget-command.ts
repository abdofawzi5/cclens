import { InvalidArgumentError, type Command } from 'commander';
import pc from 'picocolors';
import type { BudgetView } from '../../../app/budget-service.js';
import { type Budget, isBudgetSet, money } from '../../../core/domain/budget.js';
import type { CliCommand, CommandContext } from '../command.js';
import { parsePositiveInt } from '../dates.js';
import { formatOf } from '../options.js';

interface SetFlags {
  daily?: number;
  monthly?: number;
  warnAt?: number;
}

function parseUsd(value: string): number {
  const n = Number(value.replace(/^\$/, ''));
  if (!Number.isFinite(n) || n <= 0)
    throw new InvalidArgumentError('must be a positive amount in USD');
  return n;
}

function parsePercent(value: string): number {
  const n = parsePositiveInt(value);
  if (n > 100) throw new InvalidArgumentError('must be 1 to 100');
  return n;
}

function describe(budget: Budget): string {
  if (!isBudgetSet(budget)) return 'No budget set.';
  const limits = [
    budget.daily === undefined ? '' : `daily ${money(budget.daily)}`,
    budget.monthly === undefined ? '' : `monthly ${money(budget.monthly)}`,
  ].filter(Boolean);
  const at = budget.warnAt === 100 ? 'when passed' : `at ${budget.warnAt}%`;
  return `Budget: ${limits.join(', ')}; warns ${at}.`;
}

function bar(fraction: number, width = 20): string {
  const filled = Math.min(width, Math.round(fraction * width));
  return `${'█'.repeat(filled)}${'░'.repeat(width - filled)}`;
}

function renderView(view: BudgetView): string {
  const lines = [describe(view.budget)];
  for (const s of view.statuses) {
    const label = s.limit === 'daily' ? 'Today     ' : 'This month';
    const pct = `${Math.round(s.fraction * 100)}%`;
    const line = `${label} ${bar(s.fraction)} ${money(s.spentUsd)} of ${money(s.limitUsd)} (${pct})`;
    lines.push(s.over ? pc.yellow(`${line}  over`) : line);
  }
  if (view.rollup && view.statuses.length === 0) {
    lines.push(
      `Today ${money(view.rollup.todayUsd)}, this month ${money(view.rollup.monthUsd)}. Set a limit: cclens budget set --daily 50`,
    );
  }
  lines.push(pc.dim('Estimated at API list prices; a subscription plan bills differently.'));
  return lines.join('\n');
}

/** `cclens budget`: daily and monthly spending limits with a one-line warning in Claude Code. */
export class BudgetCommand implements CliCommand {
  register(program: Command, ctx: CommandContext): void {
    const budget = program
      .command('budget')
      .description(
        'set daily or monthly spend limits; Claude Code shows one warning line when passed',
      );

    budget
      .command('show', { isDefault: true })
      .description('spend so far against each limit')
      .action(async () => {
        const view = await ctx.services.budget.show();
        ctx.print(
          formatOf(program) === 'json'
            ? ctx.renderer('json', { render: () => '' }).render(view)
            : renderView(view),
        );
      });

    budget
      .command('set')
      .description('set limits in USD, e.g. --daily 50 --monthly 800')
      .option('--daily <usd>', 'daily limit', parseUsd)
      .option('--monthly <usd>', 'monthly limit', parseUsd)
      .option('--warn-at <percent>', 'warn at this percent of a limit (default 100)', parsePercent)
      .action(async (flags: SetFlags) => {
        const updated = await ctx.services.budget.set(flags);
        ctx.print(
          `${describe(updated)}\nClaude Code shows one line when a limit is passed (once a day per limit).`,
        );
      });

    budget
      .command('clear')
      .description('remove the limits (turns warnings off)')
      .action(async () => {
        await ctx.services.budget.clear();
        ctx.print('Budget cleared; no warnings will be shown.');
      });

    budget
      .command('refresh', { hidden: true })
      .description('internal: recompute the spend snapshot read by the hook and status line')
      .action(async () => {
        await ctx.services.budget.refresh();
      });
  }
}

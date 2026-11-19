import { Argument, type Command } from 'commander';
import pc from 'picocolors';
import { TOKEN_VIEWS, type TokenReport, type TokenView } from '../../../app/token-service.js';
import type { TokenCounts } from '../../../core/domain/tokens.js';
import { totalTokens } from '../../../core/domain/tokens.js';
import { compact, shortProject, usd } from '../../render/format.js';
import { TableRenderer, type Column } from '../../render/table-renderer.js';
import type { CliCommand, CommandContext } from '../command.js';
import { parseDateOption, parsePositiveInt } from '../dates.js';
import { formatOf } from '../options.js';

interface TokensFlags {
  since?: Date;
  until?: Date;
  project?: string;
  limit?: number;
}

interface Row {
  readonly label: string;
  readonly detail?: string;
  readonly counts: TokenCounts;
  readonly costUsd: number;
}

const countColumns: readonly Column<Row>[] = [
  { header: 'Input', value: (r) => compact(r.counts.input), align: 'right' },
  { header: 'Output', value: (r) => compact(r.counts.output), align: 'right' },
  { header: 'Cache write', value: (r) => compact(r.counts.cacheCreation), align: 'right' },
  { header: 'Cache read', value: (r) => compact(r.counts.cacheRead), align: 'right' },
  { header: 'Total', value: (r) => compact(totalTokens(r.counts)), align: 'right' },
  { header: 'Est. cost', value: (r) => usd(r.costUsd), align: 'right' },
];

const LABEL: Record<TokenView, string> = {
  daily: 'Day',
  weekly: 'Week of',
  monthly: 'Month',
  session: 'Session',
  project: 'Project',
  blocks: '5-hour window',
};

function toRows(report: TokenReport, home: string): Row[] {
  switch (report.view) {
    case 'daily':
    case 'weekly':
    case 'monthly':
      return report.rows.map((r) => ({ label: r.period, counts: r.counts, costUsd: r.costUsd }));
    case 'session':
      return report.rows.map((r) => ({
        label: r.sessionId.slice(0, 8),
        detail: `${shortProject(r.project, home)} · ${r.lastActivity.toLocaleString()}`,
        counts: r.counts,
        costUsd: r.costUsd,
      }));
    case 'project':
      return report.rows.map((r) => ({
        label: shortProject(r.project, home),
        counts: r.counts,
        costUsd: r.costUsd,
      }));
    case 'blocks':
      return report.rows.map((r) => ({
        label: `${r.start.toLocaleString()}${r.isActive ? ' (now)' : ''}`,
        counts: r.counts,
        costUsd: r.costUsd,
      }));
  }
}

/** `cclens tokens [view]`: token use and estimated cost, powered by ccusage. */
export class TokensCommand implements CliCommand {
  register(program: Command, ctx: CommandContext): void {
    program
      .command('tokens')
      .description('show token use and estimated cost (per day, week, month, session, project)')
      .addArgument(new Argument('[view]', 'how to group').choices(TOKEN_VIEWS).default('daily'))
      .option('--since <date>', 'from this date (YYYY-MM-DD or 7d, 4w, 3m)', (v) =>
        parseDateOption(v),
      )
      .option('--until <date>', 'up to this date', (v) => parseDateOption(v))
      .option('--project <name>', 'only this project (ccusage project name)')
      .option('--limit <n>', 'latest n periods, or top n sessions/projects', parsePositiveInt)
      .action(async (view: TokenView, flags: TokensFlags) => {
        const report = await ctx.services.tokens.report(
          view,
          {
            ...(flags.since ? { since: flags.since } : {}),
            ...(flags.until ? { until: flags.until } : {}),
            ...(flags.project ? { project: flags.project } : {}),
          },
          flags.limit,
        );
        if (formatOf(program) === 'json') {
          ctx.print(ctx.renderer('json', new TableRenderer<Row>([])).render(report));
          return;
        }
        const columns: Column<Row>[] = [{ header: LABEL[view], value: (r) => r.label }];
        if (view === 'session')
          columns.push({ header: 'Project · last active', value: (r) => r.detail ?? '' });
        const t = report.totals;
        const table = new TableRenderer<Row>([...columns, ...countColumns], {
          footer: () =>
            `${pc.bold('Total')} ${compact(t.total)} tokens · ${usd(t.costUsd)} estimated at API prices` +
            pc.dim(
              '\nCache reads are earlier conversation re-sent on every reply; they dominate long sessions.',
            ),
        });
        ctx.print(
          table.render(
            toRows(report, ctx.container.paths.claudeHome.replace(/[\\/]\.claude$/, '')),
          ),
        );
      });
  }
}

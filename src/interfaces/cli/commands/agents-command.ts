import { Option, type Command } from 'commander';
import pc from 'picocolors';
import type {
  AgentReport,
  AgentRow,
  AgentSessionRow,
  CostBasis,
} from '../../../app/agent-service.js';
import type { Agent } from '../../../core/domain/agent.js';
import { compact, shortProject, truncate, usd } from '../../render/format.js';
import { TableRenderer } from '../../render/table-renderer.js';
import type { CliCommand, CommandContext } from '../command.js';
import { parseDateOption } from '../dates.js';
import { formatOf } from '../options.js';

interface AgentsFlags {
  unused: boolean;
  by: 'type' | 'session';
  since?: Date;
}

/** `$1.23`, with a mark when the figure is a share of the session rather than priced per model. */
function cost(n: number, basis: CostBasis): string {
  return basis === 'priced' ? usd(n) : `${usd(n)}${basis === 'share' ? '*' : '~'}`;
}

function sharePercent(fraction: number): string {
  return fraction > 0 && fraction < 0.01 ? '<1%' : `${Math.round(fraction * 100)}%`;
}

const typeTable = new TableRenderer<AgentRow>([
  { header: 'Agent', value: (r) => r.agentType },
  {
    header: 'Source',
    value: (r) => (r.builtin ? 'built-in' : (r.agent?.plugin ?? r.agent?.scope ?? 'not installed')),
  },
  { header: 'Calls', value: (r) => r.calls, align: 'right' },
  { header: 'Runs', value: (r) => r.runs, align: 'right' },
  { header: 'Tokens', value: (r) => compact(r.tokens), align: 'right' },
  { header: 'Cost', value: (r) => cost(r.costUsd, r.costBasis), align: 'right' },
  { header: 'Models', value: (r) => r.models.join(', ') },
]);

function sessionTable(home: string): TableRenderer<AgentSessionRow> {
  return new TableRenderer<AgentSessionRow>([
    { header: 'Session', value: (r) => r.label },
    { header: 'Project', value: (r) => shortProject(r.project, home) },
    { header: 'Runs', value: (r) => r.runs, align: 'right' },
    { header: 'Agents', value: (r) => truncate(r.agentTypes.join(', '), 40) },
    { header: 'Tokens', value: (r) => compact(r.agentTokens), align: 'right' },
    {
      header: 'Share',
      value: (r) => (r.sessionTokens ? sharePercent(r.agentTokens / r.sessionTokens) : '-'),
      align: 'right',
    },
    { header: 'Cost', value: (r) => cost(r.costUsd, r.costBasis), align: 'right' },
  ]);
}

const unusedTable = new TableRenderer<Agent>([
  { header: 'Agent', value: (a) => a.id },
  { header: 'Source', value: (a) => a.plugin ?? a.scope },
  { header: 'Model', value: (a) => a.model ?? '' },
  { header: 'Description', value: (a) => truncate(a.description ?? '', 60) },
]);

function summary(r: AgentReport): string {
  const window = r.since ? `since ${r.since.toLocaleDateString()}` : 'over all transcripts';
  const lines = [
    `${pc.bold(String(r.totals.calls))} agent calls, ${r.totals.runs} runs, ${compact(r.totals.tokens)} tokens, ` +
      `${usd(r.totals.costUsd)} estimated ${pc.dim(`(${window})`)}`,
    pc.dim(
      `${r.installed} installed agents, ${r.unused.length} unused. Costs at API list prices` +
        '; * = share of the session’s cost, ~ = partly priced.',
    ),
  ];
  for (const n of r.notes) lines.push(pc.yellow(n));
  return lines.join('\n');
}

/** `cclens agents`: subagent calls, tokens and cost, and installed agents never used. */
export class AgentsCommand implements CliCommand {
  register(program: Command, ctx: CommandContext): void {
    program
      .command('agents')
      .description('subagent use: calls, tokens and estimated cost per agent type or session')
      .option('--unused', 'list installed agents with no call in the window', false)
      .addOption(
        new Option('--by <view>', 'group by agent type or by session')
          .choices(['type', 'session'])
          .default('type'),
      )
      .option('--since <date>', 'from this date (YYYY-MM-DD or 7d, 4w, 3m; default 30d)', (v) =>
        parseDateOption(v),
      )
      .action(async (flags: AgentsFlags) => {
        const since = flags.since ?? parseDateOption('30d', ctx.container.clock.now());
        const report = await ctx.services.agents.report({ since });
        if (formatOf(program) === 'json') {
          ctx.print(ctx.renderer('json', typeTable).render(report));
          return;
        }
        const home = ctx.container.paths.claudeHome.replace(/[\\/]\.claude$/, '');
        const body = flags.unused
          ? unusedTable.render(report.unused)
          : flags.by === 'session'
            ? sessionTable(home).render(report.bySession)
            : typeTable.render(report.byType);
        ctx.print(`${summary(report)}\n${body}`);
      });
  }
}

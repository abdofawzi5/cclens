import type { Command } from 'commander';
import pc from 'picocolors';
import type { JobReport } from '../../../app/job-service.js';
import type { Job, JobRun } from '../../../core/domain/jobs.js';
import { localDay } from '../../../core/util/format.js';
import { ValidationError } from '../../../core/errors.js';
import { compact, shortProject, truncate, usd } from '../../render/format.js';
import { TableRenderer } from '../../render/table-renderer.js';
import type { CliCommand, CommandContext } from '../command.js';
import { parseDateOption, parsePositiveInt } from '../dates.js';
import { formatOf } from '../options.js';

interface JobsFlags {
  since?: Date;
  job?: string;
  minRuns?: number;
}

function jobTable(home: string): TableRenderer<Job> {
  return new TableRenderer<Job>([
    { header: 'Job', value: (j) => truncate(j.name, 48) },
    { header: 'Kind', value: (j) => j.kind },
    { header: 'Project', value: (j) => shortProject(j.project, home) },
    { header: 'Runs', value: (j) => j.runs.length, align: 'right' },
    { header: 'Per run', value: (j) => usd(j.avgCostUsd), align: 'right' },
    { header: 'Every', value: (j) => every(j.intervalDays), align: 'right' },
    { header: 'Cost', value: (j) => usd(j.costUsd), align: 'right' },
    { header: '~Month', value: (j) => monthly(j), align: 'right' },
    { header: 'Last run', value: (j) => localDay(j.lastRun) },
  ]);
}

/** `1d`, `6h`, `3.5d`; `-` for a single run. */
export function every(days?: number): string {
  if (days === undefined) return '-';
  // Scheduled runs drift by minutes, so ~23.5h still reads as daily.
  if (days < 0.95) return `${Math.round(days * 24)}h`;
  return `${Number(days.toFixed(1))}d`;
}

/** Monthly run-rate, or why there is none. */
export function monthly(j: Job): string {
  if (!j.active) return 'stopped';
  return j.monthlyCostUsd === undefined ? 'one run' : usd(j.monthlyCostUsd);
}

const runTable = new TableRenderer<JobRun>([
  { header: 'Started', value: (r) => r.start.toLocaleString() },
  { header: 'Session', value: (r) => r.label },
  { header: 'Tokens', value: (r) => compact(r.tokens), align: 'right' },
  { header: 'Cost', value: (r) => usd(r.costUsd), align: 'right' },
]);

function summary(r: JobReport): string {
  const lines = [
    `${pc.bold(String(r.jobs.length))} recurring jobs, ${r.totals.runs} runs, ${usd(r.totals.costUsd)} ` +
      `since ${localDay(r.since)} ${pc.dim(`(~${usd(r.totals.monthlyCostUsd)} a month for active jobs at their usual pace)`)}`,
    pc.dim(
      'scheduled = started by a scheduled task; repeated = the same title run by hand. Costs are estimates at API list prices.',
    ),
  ];
  for (const n of r.notes) lines.push(pc.yellow(n));
  return lines.join('\n');
}

/** Picks one job by part of its name. */
export function findJob(jobs: readonly Job[], query: string): Job {
  const q = query.trim().toLowerCase();
  const exact = jobs.find((j) => j.name.toLowerCase() === q);
  if (exact) return exact;
  const matches = jobs.filter((j) => j.name.toLowerCase().includes(q));
  const [only] = matches;
  if (only && matches.length === 1) return only;
  if (matches.length === 0) {
    throw new ValidationError(`No job matches "${query}". List jobs with \`cclens jobs\`.`);
  }
  throw new ValidationError(
    `"${query}" matches ${matches.length} jobs: ${matches.map((j) => j.name).join(', ')}`,
  );
}

/** `cclens jobs`: scheduled and repeated tasks with runs, cost per run and monthly run-rate. */
export class JobsCommand implements CliCommand {
  register(program: Command, ctx: CommandContext): void {
    program
      .command('jobs')
      .description('scheduled and repeated tasks: runs, cost per run and per month')
      .option('--since <date>', 'from this date (YYYY-MM-DD or 7d, 4w, 3m; default 30d)', (v) =>
        parseDateOption(v),
      )
      .option('--job <name>', 'list the runs of one job (part of its name)')
      .option(
        '--min-runs <n>',
        'runs a hand-repeated title needs to count (default 3)',
        parsePositiveInt,
      )
      .action(async (flags: JobsFlags) => {
        const since = flags.since ?? parseDateOption('30d', ctx.container.clock.now());
        const report = await ctx.services.jobs.report({
          since,
          ...(flags.minRuns ? { minRepeats: flags.minRuns } : {}),
        });
        const job = flags.job ? findJob(report.jobs, flags.job) : undefined;
        if (formatOf(program) === 'json') {
          ctx.print(ctx.renderer('json', runTable).render(job ?? report));
          return;
        }
        if (job) {
          ctx.print(
            `${pc.bold(job.name)} ${pc.dim(`(${job.kind})`)}: ${job.runs.length} runs, ${usd(job.avgCostUsd)} per run, every ${every(job.intervalDays)}, ${monthly(job)}${job.active && job.monthlyCostUsd !== undefined ? ' a month' : ''}\n${runTable.render(job.runs)}`,
          );
          return;
        }
        const home = ctx.container.paths.claudeHome.replace(/[\\/]\.claude$/, '');
        ctx.print(`${summary(report)}\n${jobTable(home).render(report.jobs)}`);
      });
  }
}

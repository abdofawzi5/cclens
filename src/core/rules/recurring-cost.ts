import { groupJobs } from '../domain/jobs.js';
import type { Recommendation, Severity } from '../domain/recommendation.js';
import type { ReviewContext } from '../domain/review.js';
import type { OptimizationRule } from '../ports/review.js';
import { usd } from '../util/format.js';

export interface RecurringCostOptions {
  /** Jobs below this estimated monthly cost are not mentioned. */
  readonly minMonthlyUsd: number;
  /** At or above this monthly cost the finding is a warning. */
  readonly warnMonthlyUsd: number;
  readonly listTop: number;
}

/**
 * Scheduled tasks and hand-repeated sessions cost the same again on every run, so
 * a small saving per run adds up. Points at the costliest jobs and the levers.
 */
export class RecurringCostRule implements OptimizationRule {
  readonly id = 'recurring-cost';
  readonly description = 'Scheduled or repeated tasks with a high monthly cost';
  readonly defaultSeverity: Severity = 'warn';
  readonly appliesTo = ['window'] as const;
  private readonly options: RecurringCostOptions;

  constructor(options: Partial<RecurringCostOptions> = {}) {
    this.options = { minMonthlyUsd: 20, warnMonthlyUsd: 100, listTop: 3, ...options };
  }

  evaluate(ctx: ReviewContext): readonly Recommendation[] {
    const jobs = groupJobs(ctx.activity, ctx.sessions, { since: ctx.since, now: ctx.now })
      .flatMap((job) =>
        job.active && (job.monthlyCostUsd ?? 0) >= this.options.minMonthlyUsd
          ? [{ job, monthly: job.monthlyCostUsd ?? 0 }]
          : [],
      )
      .sort((a, b) => b.monthly - a.monthly);
    const first = jobs[0];
    if (!first) return [];
    const top = first.job;

    const monthly = jobs.reduce((n, j) => n + j.monthly, 0);
    const listed = jobs
      .slice(0, this.options.listTop)
      .map(
        ({ job: j, monthly: m }) =>
          `${j.name} (${j.kind}: ${j.runs.length} runs, ${usd(j.avgCostUsd)} per run, ~${usd(m)} a month)`,
      );
    const actions = [
      'cclens jobs   # runs and cost per job',
      'Run it on a smaller model: set the model in the task (e.g. Sonnet or Haiku for routine steps)',
      'Shorten the task prompt and turn off tools and MCP servers it does not need',
      'Run it less often, or batch several items into one run',
    ];
    if (top.kind === 'scheduled') {
      actions.splice(1, 0, `Edit the task: ~/.claude/scheduled-tasks/${top.name}/SKILL.md`);
    }
    return [
      {
        ruleId: this.id,
        severity: monthly >= this.options.warnMonthlyUsd ? 'warn' : 'info',
        title: `${jobs.length} recurring job${jobs.length === 1 ? '' : 's'} cost ~${usd(monthly)} a month`,
        detail: [
          `These tasks run again and again, so their cost repeats at the recent pace: ${listed.join('; ')}.`,
          `Saving 30% per run on ${top.name} alone would save about ${usd(first.monthly * 0.3)} a month.`,
          'Costs are estimates at API list prices.',
        ].join(' '),
        actions,
      },
    ];
  }
}

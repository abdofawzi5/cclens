import {
  type Advice,
  budgetAdvice,
  jobQuery,
  jobsToSearch,
  matchesQuery,
  overheadAdvice,
  rankSuggestions,
  type SkillSuggestion,
} from '../core/domain/advice.js';
import { buildActionPlan } from '../core/domain/action-plan.js';
import type { Budget, BudgetStatus } from '../core/domain/budget.js';
import type { FixHint } from '../core/domain/fix-hints.js';
import { groupJobs } from '../core/domain/jobs.js';
import type { OverheadSummary } from '../core/domain/overhead.js';
import { describeError } from '../core/errors.js';
import type { BudgetService } from './budget-service.js';
import type { ContextService } from './context-service.js';
import type { InventoryService } from './inventory/inventory-service.js';
import type { ReviewService } from './review-service.js';
import type { SearchService } from './search/search-service.js';

export interface AdviseOptions {
  /** Days to look back (defaults to the config's `review.windowDays`). */
  readonly windowDays?: number;
  /** Ask the AI reviewer for a second opinion too. */
  readonly ai?: boolean;
  /** Search the skill registries for the repeated tasks (network; on by default). */
  readonly search?: boolean;
  /** How many repeated tasks to search skills for. */
  readonly searchJobs?: number;
  /** Skills shown per task. */
  readonly perJob?: number;
}

export interface AdviseDeps {
  readonly review: Pick<ReviewService, 'analyse'>;
  readonly context: Pick<ContextService, 'report'>;
  readonly inventory: Pick<InventoryService, 'fixHints'>;
  readonly search?: Pick<SearchService, 'search'>;
  readonly budget?: Pick<BudgetService, 'show'>;
}

/**
 * `cclens advise`: runs every analysis at once, then ranks one list of suggestions,
 * the plugins to turn off and skills that might take over repeated tasks. A source
 * that fails becomes a note, so the advice is partial instead of failing.
 */
export class AdviseService {
  constructor(private readonly deps: AdviseDeps) {}

  async advise(options: AdviseOptions = {}): Promise<Advice> {
    const notes: string[] = [];
    const guard = async <T>(what: string, fallback: T, task: () => Promise<T>): Promise<T> => {
      try {
        return await task();
      } catch (error) {
        notes.push(`Could not load ${what}: ${describeError(error)}`);
        return fallback;
      }
    };

    const analysis = await this.deps.review.analyse({
      ...(options.windowDays ? { windowDays: options.windowDays } : {}),
      ...(options.ai ? { ai: true } : {}),
    });
    const { report, context: ctx } = analysis;
    const budgetDep = this.deps.budget;
    const [overhead, disable, budgetView] = await Promise.all([
      guard('context overhead', undefined as OverheadSummary | undefined, () =>
        this.deps.context.report({ since: ctx.since }),
      ),
      guard('unused plugins', [] as readonly FixHint[], () =>
        this.deps.inventory.fixHints({ since: ctx.since }),
      ),
      budgetDep
        ? guard(
            'budget',
            undefined as { budget: Budget; statuses: readonly BudgetStatus[] } | undefined,
            () => budgetDep.show(),
          )
        : Promise.resolve(undefined),
    ]);

    const discover = await this.discover(ctx, options, notes);

    return {
      since: report.since,
      until: report.until,
      windowDays: ctx.windowDays,
      summary: report.summary,
      ...(overhead && overhead.sessions > 0 ? { contextTokens: overhead.averageTokens } : {}),
      suggestions: rankSuggestions(
        report.recommendations,
        overhead ? overheadAdvice(overhead) : [],
        budgetAdvice(
          budgetView?.budget,
          budgetView?.statuses ?? [],
          report.summary,
          ctx.windowDays,
        ),
      ),
      disable,
      discover,
      budget: budgetView?.statuses ?? [],
      plan: buildActionPlan({
        jobs: groupJobs(ctx.activity, ctx.sessions, { since: ctx.since, now: ctx.now }),
        activity: ctx.activity,
        sessions: ctx.sessions,
        ...(overhead ? { overhead } : {}),
        disable,
        windowDays: ctx.windowDays,
      }),
      notes: [...report.notes, ...notes],
    };
  }

  private async discover(
    ctx: Awaited<ReturnType<ReviewService['analyse']>>['context'],
    options: AdviseOptions,
    notes: string[],
  ): Promise<readonly SkillSuggestion[]> {
    const search = this.deps.search;
    if (options.search === false || !search) return [];
    const jobs = jobsToSearch(
      groupJobs(ctx.activity, ctx.sessions, { since: ctx.since, now: ctx.now }),
      options.searchJobs ?? 3,
    );
    const perJob = options.perJob ?? 3;
    const found = await Promise.all(
      jobs.map(async (job): Promise<SkillSuggestion | undefined> => {
        const query = jobQuery(job.name);
        try {
          const r = await search.search(query, { limit: perJob + 10 });
          const results = r.results
            .filter((x) => !x.installed && matchesQuery(x, query))
            .slice(0, perJob);
          return results.length > 0 ? { job, query, results } : undefined;
        } catch (error) {
          notes.push(`Skill search for "${query}" failed: ${describeError(error)}`);
          return undefined;
        }
      }),
    );
    return found.filter((s): s is SkillSuggestion => s !== undefined);
  }
}

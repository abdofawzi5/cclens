import { groupJobs, type Job } from '../core/domain/jobs.js';
import type { SessionActivity } from '../core/domain/review.js';
import type { SessionTokens } from '../core/domain/tokens.js';
import { describeError } from '../core/errors.js';
import type { Clock } from '../core/ports/infrastructure.js';
import type { SessionActivitySource } from '../core/ports/review.js';
import type { TokenUsageProvider } from '../core/ports/tokens.js';

export interface JobReport {
  readonly since: Date;
  readonly until: Date;
  /** Costliest first. */
  readonly jobs: readonly Job[];
  readonly totals: {
    readonly runs: number;
    readonly costUsd: number;
    readonly monthlyCostUsd: number;
  };
  readonly notes: readonly string[];
}

/** `cclens jobs`: scheduled and repeated tasks, with cost per run and per month. */
export class JobService {
  constructor(
    private readonly tokens: TokenUsageProvider,
    private readonly activity: SessionActivitySource,
    private readonly clock: Clock,
  ) {}

  async report(options: { since: Date; minRepeats?: number }): Promise<JobReport> {
    const notes: string[] = [];
    const [sessions, activity] = await Promise.all([
      this.tokens.bySession({ since: options.since }).catch((error: unknown) => {
        notes.push(`Could not load session tokens (ccusage): ${describeError(error)}`);
        return [] as readonly SessionTokens[];
      }),
      this.activity.read(options.since).catch((error: unknown) => {
        notes.push(`Could not read transcripts: ${describeError(error)}`);
        return [] as readonly SessionActivity[];
      }),
    ]);
    const now = this.clock.now();
    const jobs = groupJobs(activity, sessions, {
      since: options.since,
      now,
      ...(options.minRepeats ? { minRepeats: options.minRepeats } : {}),
    });
    return {
      since: options.since,
      until: now,
      jobs,
      totals: {
        runs: jobs.reduce((n, j) => n + j.runs.length, 0),
        costUsd: jobs.reduce((n, j) => n + j.costUsd, 0),
        monthlyCostUsd: jobs.reduce((n, j) => n + (j.monthlyCostUsd ?? 0), 0),
      },
      notes,
    };
  }
}

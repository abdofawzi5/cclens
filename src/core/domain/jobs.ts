import type { SessionActivity } from './review.js';
import { SessionLabels } from './session-labels.js';
import { type SessionTokens, totalTokens } from './tokens.js';
import { median } from '../util/estimate-tokens.js';

/** `scheduled`: started by a Claude scheduled task. `repeated`: the same title run by hand again and again. */
export type JobKind = 'scheduled' | 'repeated';

export interface JobRun {
  readonly sessionId: string;
  readonly label: string;
  readonly start: Date;
  readonly tokens: number;
  readonly costUsd: number;
}

/** Sessions from one recurring task. */
export interface Job {
  /** Stable id: `scheduled:<task>` or `repeated:<project>:<normalized title>`. */
  readonly key: string;
  /** The scheduled task's name, or the latest run's title. */
  readonly name: string;
  readonly kind: JobKind;
  readonly project: string;
  /** Oldest first. */
  readonly runs: readonly JobRun[];
  readonly tokens: number;
  readonly costUsd: number;
  readonly avgCostUsd: number;
  readonly firstRun: Date;
  readonly lastRun: Date;
  /** Average time between runs, in days; undefined with a single run. */
  readonly intervalDays?: number;
  /** False when the job is overdue by more than twice its usual interval (it looks stopped). */
  readonly active: boolean;
  /**
   * Expected cost per 30 days if the job keeps going: average cost per run × runs per
   * 30 days at its usual interval (scheduled), or the window's cost spread over the days
   * since the first run (repeated). 0 when stopped; undefined with a single run.
   */
  readonly monthlyCostUsd?: number;
}

export interface JobOptions {
  /** Start of the window; the run-rate counts days from here or the first run, whichever is later. */
  readonly since: Date;
  readonly now: Date;
  /** A hand-run title needs this many runs to count as a job. */
  readonly minRepeats?: number;
}

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;

/**
 * Titles of one repeated task differ only in dates, numbers and quoted names
 * (`Daily report 2026-11-19`, `Episode 12: "The Moon"`); strip those to compare.
 */
export function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/"[^"]*"|“[^”]*”|'[^']*'|«[^»]*»/g, ' ')
    .replace(/\d{4}-\d{2}-\d{2}(?:[t ]\d{2}:\d{2}(?::\d{2})?)?/g, ' ')
    .replace(/\d+/g, ' ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

/** Groups sessions into recurring jobs, costliest first. Pure; costs come from ccusage sessions. */
export function groupJobs(
  activity: readonly SessionActivity[],
  sessions: readonly SessionTokens[],
  options: JobOptions,
): readonly Job[] {
  const minRepeats = options.minRepeats ?? 3;
  const tokensById = new Map(sessions.map((s) => [s.sessionId, s]));
  const labels = SessionLabels.from(activity);
  const groups = new Map<string, { kind: JobKind; project: string; runs: SessionActivity[] }>();

  for (const a of activity) {
    let key: string;
    let kind: JobKind;
    if (a.scheduledTask) {
      key = `scheduled:${a.scheduledTask}`;
      kind = 'scheduled';
    } else {
      const normalized = a.title ? normalizeTitle(a.title.text) : '';
      if (!normalized) continue;
      key = `repeated:${a.project}:${normalized}`;
      kind = 'repeated';
    }
    const g = groups.get(key) ?? { kind, project: a.project, runs: [] };
    g.runs.push(a);
    groups.set(key, g);
  }

  const jobs: Job[] = [];
  for (const [key, g] of groups) {
    if (g.kind === 'repeated' && g.runs.length < minRepeats) continue;
    const sorted = [...g.runs].sort(
      (a, b) => a.firstActivity.getTime() - b.firstActivity.getTime(),
    );
    const runs: JobRun[] = sorted.map((a) => {
      const t = tokensById.get(a.sessionId);
      return {
        sessionId: a.sessionId,
        label: labels.label(a.sessionId),
        start: a.firstActivity,
        tokens: t ? totalTokens(t.counts) : 0,
        costUsd: t?.costUsd ?? 0,
      };
    });
    const first = sorted[0];
    const last = sorted[sorted.length - 1];
    if (!first || !last) continue;
    const costUsd = runs.reduce((n, r) => n + r.costUsd, 0);
    const avgCostUsd = costUsd / runs.length;
    const now = options.now.getTime();
    // Median gap, so one extra manual run does not skew a daily schedule.
    const gaps = runs.slice(1).map((r, i) => r.start.getTime() - (runs[i]?.start.getTime() ?? 0));
    const interval = gaps.length > 0 ? Math.max(HOUR_MS, median(gaps)) : undefined;
    // Allow a day of slack so a daily job that has not fired yet today still counts as active.
    const active =
      interval === undefined || now - last.firstActivity.getTime() <= 2 * interval + DAY_MS;
    let monthlyCostUsd: number | undefined;
    if (interval !== undefined) {
      if (!active) monthlyCostUsd = 0;
      else if (g.kind === 'scheduled') monthlyCostUsd = avgCostUsd * ((30 * DAY_MS) / interval);
      else {
        const from = Math.max(options.since.getTime(), first.firstActivity.getTime());
        monthlyCostUsd = (costUsd / Math.max(1, Math.ceil((now - from) / DAY_MS))) * 30;
      }
    }
    jobs.push({
      key,
      name: g.kind === 'scheduled' ? key.slice('scheduled:'.length) : (last.title?.text ?? key),
      kind: g.kind,
      project: g.project,
      runs,
      tokens: runs.reduce((n, r) => n + r.tokens, 0),
      costUsd,
      avgCostUsd,
      firstRun: first.firstActivity,
      lastRun: last.firstActivity,
      ...(interval === undefined ? {} : { intervalDays: interval / DAY_MS }),
      active,
      ...(monthlyCostUsd === undefined ? {} : { monthlyCostUsd }),
    });
  }
  return jobs.sort((a, b) => b.costUsd - a.costUsd || b.runs.length - a.runs.length);
}

import {
  USAGE_EVENT_VERSION,
  usageEventKey,
  type UsageEvent,
  type UsageFilter,
  type UsageSource,
} from '../core/domain/usage-event.js';
import type { Clock } from '../core/ports/infrastructure.js';
import type { UsageEventStore, UsageHistorySource } from '../core/ports/usage.js';

export interface RecordInput {
  readonly skill: string;
  readonly source: Extract<UsageSource, 'auto' | 'typed'>;
  readonly project: string;
  readonly sessionId?: string;
}

export interface ImportReport {
  readonly sourceId: string;
  readonly read: number;
  readonly imported: number;
  readonly duplicates: number;
}

/** Use cases for skill usage: live recording, history import, counting. */
export class UsageService {
  constructor(
    private readonly store: UsageEventStore,
    private readonly clock: Clock,
  ) {}

  async record(input: RecordInput): Promise<UsageEvent> {
    const event: UsageEvent = {
      v: USAGE_EVENT_VERSION,
      ts: this.clock.now(),
      source: input.source,
      skill: input.skill,
      project: input.project,
      ...(input.sessionId === undefined ? {} : { sessionId: input.sessionId }),
    };
    await this.store.append(event);
    return event;
  }

  /**
   * Imports history without double counting:
   * - skips events already in the store (same timestamp, skill and session);
   * - skips events at or after the first live event, which the hooks already captured.
   */
  async import(source: UsageHistorySource, since?: Date): Promise<ImportReport> {
    const known = new Set<string>();
    let firstLive: Date | undefined;
    for await (const e of this.store.query()) {
      known.add(usageEventKey(e));
      if ((e.source === 'auto' || e.source === 'typed') && (!firstLive || e.ts < firstLive)) {
        firstLive = e.ts;
      }
    }

    const fresh: UsageEvent[] = [];
    let read = 0;
    for await (const e of source.read(since)) {
      read += 1;
      const key = usageEventKey(e);
      if (known.has(key) || (firstLive && e.ts >= firstLive)) continue;
      known.add(key);
      fresh.push(e);
    }
    fresh.sort((a, b) => a.ts.getTime() - b.ts.getTime());
    await this.store.appendMany(fresh);
    return { sourceId: source.id, read, imported: fresh.length, duplicates: read - fresh.length };
  }

  /** Uses per qualified skill id, most used first. */
  countBySkill(filter?: UsageFilter): Promise<ReadonlyMap<string, number>> {
    return this.countBy(USAGE_GROUPINGS.skill, filter);
  }

  /** Uses grouped by any key (skill, local day, project…), largest group first. */
  async countBy(
    key: (e: UsageEvent) => string,
    filter?: UsageFilter,
  ): Promise<ReadonlyMap<string, number>> {
    const counts = new Map<string, number>();
    for await (const e of this.store.query(filter)) {
      const k = key(e);
      counts.set(k, (counts.get(k) ?? 0) + 1);
    }
    return new Map([...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])));
  }

  /** Time of the earliest recorded use, or undefined when nothing is recorded. */
  async firstUse(): Promise<Date | undefined> {
    let first: Date | undefined;
    for await (const e of this.store.query()) if (!first || e.ts < first) first = e.ts;
    return first;
  }

  async total(filter?: UsageFilter): Promise<number> {
    let n = 0;
    for await (const event of this.store.query(filter)) if (event.skill) n += 1;
    return n;
  }
}

const pad = (n: number): string => String(n).padStart(2, '0');

/** Ready-made groupings for `countBy` (Strategy). Days are in local time. */
export const USAGE_GROUPINGS = {
  skill: (e: UsageEvent): string => e.skill,
  day: (e: UsageEvent): string =>
    `${e.ts.getFullYear()}-${pad(e.ts.getMonth() + 1)}-${pad(e.ts.getDate())}`,
  project: (e: UsageEvent): string => e.project || '(unknown)',
  source: (e: UsageEvent): string => e.source,
} as const;

export type UsageGrouping = keyof typeof USAGE_GROUPINGS;

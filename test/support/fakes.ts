import type { Clock } from '../../src/core/ports/infrastructure.js';
import type { Logger } from '../../src/core/ports/infrastructure.js';
import {
  matchesUsageFilter,
  type UsageEvent,
  type UsageFilter,
} from '../../src/core/domain/usage-event.js';
import type { UsageEventStore, UsageHistorySource } from '../../src/core/ports/usage.js';

export class FixedClock implements Clock {
  constructor(public time: Date = new Date('2026-11-19T12:00:00Z')) {}
  now(): Date {
    return new Date(this.time);
  }
}

export class MemoryLogger implements Logger {
  readonly entries: { level: string; message: string; meta?: Record<string, unknown> }[] = [];
  debug(message: string, meta?: Record<string, unknown>): void {
    this.entries.push({ level: 'debug', message, ...(meta ? { meta } : {}) });
  }
  warn(message: string, meta?: Record<string, unknown>): void {
    this.entries.push({ level: 'warn', message, ...(meta ? { meta } : {}) });
  }
  error(message: string, meta?: Record<string, unknown>): void {
    this.entries.push({ level: 'error', message, ...(meta ? { meta } : {}) });
  }
}

export class MemoryEventStore implements UsageEventStore {
  events: UsageEvent[] = [];
  created = false;
  ensure(): Promise<void> {
    this.created = true;
    return Promise.resolve();
  }
  exists(): Promise<boolean> {
    return Promise.resolve(this.created);
  }
  append(event: UsageEvent): Promise<void> {
    this.events.push(event);
    return Promise.resolve();
  }
  appendMany(events: readonly UsageEvent[]): Promise<void> {
    this.events.push(...events);
    return Promise.resolve();
  }
  async *query(filter: UsageFilter = {}): AsyncIterable<UsageEvent> {
    await Promise.resolve();
    for (const e of this.events) if (matchesUsageFilter(e, filter)) yield e;
  }
}

export class ArraySource implements UsageHistorySource {
  readonly description = 'test source';
  constructor(
    readonly id: string,
    private readonly events: readonly UsageEvent[],
  ) {}
  async *read(since?: Date): AsyncIterable<UsageEvent> {
    await Promise.resolve();
    for (const e of this.events) if (!since || e.ts >= since) yield e;
  }
}

export function event(skill: string, iso: string, extra: Partial<UsageEvent> = {}): UsageEvent {
  return { v: 1, ts: new Date(iso), source: 'backfill', skill, project: 'p', ...extra };
}

/** `Array.fromAsync` replacement; that API needs Node 22 and cclens supports Node 20. */
export async function collect<T>(items: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const item of items) out.push(item);
  return out;
}

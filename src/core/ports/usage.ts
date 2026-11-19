import type { UsageEvent, UsageFilter } from '../domain/usage-event.js';

/** Append-only store of skill usage events. */
export interface UsageEventStore {
  /** Creates the backing storage if needed. Safe to call repeatedly. */
  ensure(): Promise<void>;
  exists(): Promise<boolean>;
  append(event: UsageEvent): Promise<void>;
  appendMany(events: readonly UsageEvent[]): Promise<void>;
  query(filter?: UsageFilter): AsyncIterable<UsageEvent>;
}

/** Read-only history to import from (Claude Code transcripts, the legacy log). */
export interface UsageHistorySource {
  readonly id: string;
  readonly description: string;
  read(since?: Date): AsyncIterable<UsageEvent>;
}

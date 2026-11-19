import { createReadStream } from 'node:fs';
import { access } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import { USAGE_EVENT_VERSION, type UsageEvent } from '../../../core/domain/usage-event.js';
import type { UsageHistorySource } from '../../../core/ports/usage.js';

/** `2026-11-19 17:46:49` in local time, as written by `date '+%Y-%m-%d %H:%M:%S'`. */
const LOCAL_TS = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/;

function parseLocalTimestamp(text: string): Date | undefined {
  const m = LOCAL_TS.exec(text);
  if (!m) return undefined;
  const [y, mo, d, h, mi, s] = m.slice(1).map(Number);
  if ([y, mo, d, h, mi, s].some((n) => n === undefined || Number.isNaN(n))) return undefined;
  return new Date(y as number, (mo as number) - 1, d, h, mi, s);
}

/**
 * Reads the tab-separated log written by the manual pre-cclens hook:
 * `timestamp<TAB>auto|typed<TAB>skill<TAB>project`.
 */
export class LegacyLogSource implements UsageHistorySource {
  readonly id = 'legacy-log';
  readonly description = 'the old skill-usage.log';

  constructor(private readonly file: string) {}

  async *read(since?: Date): AsyncIterable<UsageEvent> {
    try {
      await access(this.file);
    } catch {
      return;
    }
    const lines = createInterface({
      input: createReadStream(this.file, 'utf8'),
      crlfDelay: Infinity,
    });
    for await (const line of lines) {
      const [rawTs, , skill, project] = line.split('\t');
      const ts = rawTs ? parseLocalTimestamp(rawTs) : undefined;
      if (!ts || !skill || (since && ts < since)) continue;
      yield { v: USAGE_EVENT_VERSION, ts, source: 'legacy', skill, project: project ?? '' };
    }
  }
}

import { createReadStream } from 'node:fs';
import { access, appendFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { createInterface } from 'node:readline';
import {
  matchesUsageFilter,
  type UsageEvent,
  type UsageFilter,
} from '../../core/domain/usage-event.js';
import type { Logger } from '../../core/ports/infrastructure.js';
import type { UsageEventStore } from '../../core/ports/usage.js';
import { decodeUsageEvent, encodeUsageEvent } from './usage-event-codec.js';

/**
 * Append-only JSON Lines file. Each append is one small `O_APPEND` write, which the OS
 * keeps atomic, so concurrent hook processes never interleave lines.
 */
export class JsonlEventStore implements UsageEventStore {
  constructor(
    private readonly file: string,
    private readonly logger?: Logger,
  ) {}

  async ensure(): Promise<void> {
    await mkdir(dirname(this.file), { recursive: true });
    await appendFile(this.file, '', { mode: 0o600 });
  }

  async exists(): Promise<boolean> {
    try {
      await access(this.file);
      return true;
    } catch {
      return false;
    }
  }

  async append(event: UsageEvent): Promise<void> {
    await this.appendMany([event]);
  }

  async appendMany(events: readonly UsageEvent[]): Promise<void> {
    if (events.length === 0) return;
    await mkdir(dirname(this.file), { recursive: true });
    await appendFile(this.file, events.map((e) => `${encodeUsageEvent(e)}\n`).join(''), {
      mode: 0o600,
    });
  }

  async *query(filter: UsageFilter = {}): AsyncIterable<UsageEvent> {
    if (!(await this.exists())) return;
    const lines = createInterface({
      input: createReadStream(this.file, 'utf8'),
      crlfDelay: Infinity,
    });
    let lineNo = 0;
    for await (const line of lines) {
      lineNo += 1;
      const event = decodeUsageEvent(line);
      if (!event) {
        if (line.trim())
          this.logger?.warn('Skipped malformed usage event', { file: this.file, lineNo });
        continue;
      }
      if (matchesUsageFilter(event, filter)) yield event;
    }
  }
}

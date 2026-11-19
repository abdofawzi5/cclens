import { createHash } from 'node:crypto';
import { readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import type { Cache, Clock } from '../../core/ports/infrastructure.js';
import { writeFileAtomic } from './atomic-write.js';

interface Entry {
  readonly expiresAt: number;
  readonly value: unknown;
}

/**
 * JSON file per key under the cache folder, with a TTL. Values must be plain JSON;
 * callers convert dates themselves. A broken or expired file counts as a miss.
 */
export class FileCache implements Cache {
  constructor(
    private readonly dir: string,
    private readonly clock: Clock,
  ) {}

  async get<T>(key: string): Promise<T | undefined> {
    const path = this.path(key);
    try {
      const entry = JSON.parse(await readFile(path, 'utf8')) as Entry;
      if (typeof entry.expiresAt === 'number' && entry.expiresAt > this.clock.now().getTime()) {
        return entry.value as T;
      }
      await rm(path, { force: true });
    } catch {
      // Missing or unreadable: a miss.
    }
    return undefined;
  }

  async set(key: string, value: unknown, ttlSeconds: number): Promise<void> {
    if (ttlSeconds <= 0) return;
    const entry: Entry = { expiresAt: this.clock.now().getTime() + ttlSeconds * 1000, value };
    await writeFileAtomic(this.path(key), JSON.stringify(entry));
  }

  private path(key: string): string {
    return join(this.dir, `${createHash('sha256').update(key).digest('hex').slice(0, 32)}.json`);
  }
}

import type { EngineDescriptor, SearchQuery, SearchResult } from '../../core/domain/search.js';
import { EngineError } from '../../core/errors.js';
import type { Cache } from '../../core/ports/infrastructure.js';
import type { SkillSearchEngine } from '../../core/ports/search.js';

/** Decorator: fails the engine with a clear message when it takes longer than `ms`. */
export class TimeoutEngine implements SkillSearchEngine {
  constructor(
    private readonly inner: SkillSearchEngine,
    private readonly ms: number,
  ) {}

  get descriptor(): EngineDescriptor {
    return this.inner.descriptor;
  }

  async search(query: SearchQuery, signal: AbortSignal): Promise<readonly SearchResult[]> {
    const timeout = AbortSignal.timeout(this.ms);
    const combined = AbortSignal.any([signal, timeout]);
    try {
      return await this.inner.search(query, combined);
    } catch (error) {
      if (timeout.aborted) {
        throw new EngineError(
          this.descriptor.id,
          `${this.descriptor.id}: no answer within ${this.ms / 1000}s`,
          {
            cause: error,
          },
        );
      }
      throw error;
    }
  }
}

type Stored = Omit<SearchResult, 'updatedAt'> & { updatedAt?: string };

const toStored = (r: SearchResult): Stored => {
  const { updatedAt, ...rest } = r;
  return updatedAt ? { ...rest, updatedAt: updatedAt.toISOString() } : rest;
};
const fromStored = (r: Stored): SearchResult => {
  const { updatedAt, ...rest } = r;
  return updatedAt ? { ...rest, updatedAt: new Date(updatedAt) } : rest;
};

export interface CachingOptions {
  readonly ttlSeconds: number;
  /** Skip reading the cache (still refreshes it). */
  readonly refresh: boolean;
  /** Called when results came from the cache. */
  readonly onHit?: (engineId: string) => void;
}

/** Decorator: caches an engine's results per query for `ttlSeconds`. */
export class CachingEngine implements SkillSearchEngine {
  constructor(
    private readonly inner: SkillSearchEngine,
    private readonly cache: Cache,
    private readonly options: CachingOptions,
  ) {}

  get descriptor(): EngineDescriptor {
    return this.inner.descriptor;
  }

  async search(query: SearchQuery, signal: AbortSignal): Promise<readonly SearchResult[]> {
    const d = this.descriptor;
    const key = `search:v1:${d.type}:${d.id}:${query.limit}:${query.text.trim().toLowerCase()}`;
    if (!this.options.refresh && this.options.ttlSeconds > 0) {
      const hit = await this.cache.get<Stored[]>(key);
      if (hit) {
        this.options.onHit?.(d.id);
        return hit.map(fromStored);
      }
    }
    const results = await this.inner.search(query, signal);
    await this.cache
      .set(key, results.map(toStored), this.options.ttlSeconds)
      .catch(() => undefined);
    return results;
  }
}

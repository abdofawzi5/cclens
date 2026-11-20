import type { EngineConfig } from '../../core/config/schema.js';
import type {
  EngineOutcome,
  RepoRef,
  SearchQuery,
  SearchReport,
  SearchResult,
  SearchSort,
} from '../../core/domain/search.js';
import { describeError, EngineError, ValidationError } from '../../core/errors.js';
import type { Cache, Clock } from '../../core/ports/infrastructure.js';
import type {
  EngineFactory,
  RepoMetadataProvider,
  SkillSearchEngine,
} from '../../core/ports/search.js';
import type { SkillSource } from '../../core/ports/skills.js';
import { mergeResults, withPositionRelevance } from '../../core/search/merge.js';
import { RANKINGS } from '../../core/search/ranking.js';
import { repoKey } from '../../core/util/repo-ref.js';
import type { ConfigService } from '../config-service.js';
import { CachingEngine, TimeoutEngine } from './engine-decorators.js';

export interface SearchOptions {
  readonly limit?: number;
  readonly sort?: SearchSort;
  readonly minStars?: number;
  /** Only these engine ids (may include disabled ones). */
  readonly engines?: readonly string[];
  /** Ignore cached results. */
  readonly refresh?: boolean;
  /** Keep archived repositories. */
  readonly includeArchived?: boolean;
}

export interface SearchDeps {
  readonly config: ConfigService;
  readonly factory: EngineFactory;
  readonly cache: Cache;
  readonly clock: Clock;
  readonly metadata?: RepoMetadataProvider;
  readonly skills?: SkillSource;
}

const ENRICH_TIMEOUT_MS = 10_000;

/**
 * R5: searches every selected engine in parallel, merges duplicates, adds GitHub
 * stars where an engine has none, marks skills already installed, filters and ranks.
 * One engine failing becomes an outcome in the report, never a failed search.
 */
export class SearchService {
  constructor(private readonly deps: SearchDeps) {}

  async search(text: string, options: SearchOptions = {}): Promise<SearchReport> {
    const trimmed = text.trim();
    if (!trimmed)
      throw new ValidationError('Give something to search for, e.g. `cclens search seo`.');
    const config = await this.deps.config.load();
    const query: SearchQuery = {
      text: trimmed,
      limit: options.limit ?? config.search.defaultLimit,
      sort: options.sort ?? config.search.defaultSort,
      minStars: options.minStars ?? config.search.minStars,
      ...(options.engines ? { engines: options.engines } : {}),
    };

    const selected = this.select(config.engines, options.engines);
    if (selected.length === 0) {
      throw new ValidationError(
        'No search engines are enabled. Turn one on with `cclens engines enable <id>`.',
      );
    }

    // Ask each engine for a few more than needed so merging and filters still fill the page.
    const perEngine: SearchQuery = { ...query, limit: Math.min(100, Math.max(query.limit, 20)) };
    const cachedIds = new Set<string>();
    const controller = new AbortController();
    const runs = selected.map(async (cfg) => {
      const started = this.deps.clock.now().getTime();
      const engine = this.wrap(cfg, options.refresh ?? false, (id) => cachedIds.add(id));
      try {
        const results = await engine.search(perEngine, controller.signal);
        const ms = this.deps.clock.now().getTime() - started;
        const outcome: EngineOutcome = {
          engineId: cfg.id,
          ok: true,
          count: results.length,
          ms,
          cached: cachedIds.has(cfg.id),
        };
        return { outcome, results: withPositionRelevance(results) };
      } catch (error) {
        const ms = this.deps.clock.now().getTime() - started;
        const outcome: EngineOutcome = {
          engineId: cfg.id,
          ok: false,
          error: describeError(error),
          ms,
        };
        return { outcome, results: [] as SearchResult[] };
      }
    });
    const settled = await Promise.all(runs);

    const notes: string[] = [];
    let merged = mergeResults(settled.flatMap((s) => s.results));
    merged = await this.enrich(merged, notes);
    merged = await this.markInstalled(merged);
    const totalFound = merged.length;

    const minStars = query.minStars ?? 0;
    const filtered = merged.filter(
      (r) =>
        (options.includeArchived || !r.archived) && (minStars <= 0 || (r.stars ?? 0) >= minStars),
    );
    const ranked = RANKINGS[query.sort].rank(filtered, query).slice(0, query.limit);

    return {
      query,
      results: ranked,
      outcomes: settled.map((s) => s.outcome),
      totalFound,
      filteredOut: totalFound - filtered.length,
      notes,
    };
  }

  private select(engines: readonly EngineConfig[], ids?: readonly string[]): EngineConfig[] {
    if (!ids || ids.length === 0) return engines.filter((e) => e.enabled);
    return ids.map((id) => {
      const found = engines.find((e) => e.id === id);
      if (!found) {
        const known = engines.map((e) => e.id).join(', ');
        throw new EngineError(id, `Unknown engine "${id}". Known engines: ${known}`, {
          unknown: true,
        });
      }
      return found;
    });
  }

  private wrap(
    cfg: EngineConfig,
    refresh: boolean,
    onHit: (id: string) => void,
  ): SkillSearchEngine {
    const engine = new TimeoutEngine(this.deps.factory.create(cfg), cfg.timeoutMs);
    return new CachingEngine(engine, this.deps.cache, {
      ttlSeconds: cfg.cacheTtlSeconds,
      refresh,
      onHit,
    });
  }

  /** Adds stars (and archive status) from GitHub to results that lack them. */
  private async enrich(results: SearchResult[], notes: string[]): Promise<SearchResult[]> {
    const metadata = this.deps.metadata;
    const missing = results
      .filter((r) => r.repo && r.stars === undefined)
      .map((r) => r.repo as RepoRef);
    if (!metadata || missing.length === 0) return results;
    try {
      const meta = await metadata.enrich(missing, AbortSignal.timeout(ENRICH_TIMEOUT_MS));
      return results.map((r) => {
        const m = r.repo && r.stars === undefined ? meta.get(repoKey(r.repo)) : undefined;
        if (!m) return r;
        return {
          ...r,
          stars: m.stars,
          ...(r.description === undefined && m.description ? { description: m.description } : {}),
          ...(r.updatedAt === undefined && m.pushedAt ? { updatedAt: m.pushedAt } : {}),
          ...(m.archived ? { archived: true } : {}),
        };
      });
    } catch (error) {
      notes.push(`Could not add GitHub stars: ${describeError(error)}`);
      return results;
    }
  }

  private async markInstalled(results: SearchResult[]): Promise<SearchResult[]> {
    if (!this.deps.skills) return results;
    let names: Set<string>;
    try {
      names = new Set((await this.deps.skills.list()).map((s) => s.name.toLowerCase()));
    } catch {
      return results;
    }
    return results.map((r) =>
      r.kind === 'skill' && names.has(r.name.toLowerCase()) ? { ...r, installed: true } : r,
    );
  }
}

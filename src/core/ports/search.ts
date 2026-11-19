import type { EngineConfig } from '../config/schema.js';
import type {
  EngineDescriptor,
  RepoMeta,
  RepoRef,
  SearchQuery,
  SearchResult,
} from '../domain/search.js';

/** A skill registry or search backend. */
export interface SkillSearchEngine {
  readonly descriptor: EngineDescriptor;
  search(query: SearchQuery, signal: AbortSignal): Promise<readonly SearchResult[]>;
}

/** Adds repository metadata (stars, activity) to results. Backed by GitHub. */
export interface RepoMetadataProvider {
  enrich(repos: readonly RepoRef[], signal: AbortSignal): Promise<ReadonlyMap<string, RepoMeta>>;
}

/** Orders merged results. */
export interface RankingStrategy {
  readonly id: string;
  rank(results: readonly SearchResult[], query: SearchQuery): readonly SearchResult[];
}

/** Builds a search engine from its config entry (Factory). */
export interface EngineFactory {
  /** Engine types this factory can build, e.g. `github`, `generic-http`. */
  readonly types: readonly string[];
  create(config: EngineConfig): SkillSearchEngine;
}

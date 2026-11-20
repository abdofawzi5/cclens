/** A GitHub repository reference, the key used to merge results across engines. */
export interface RepoRef {
  readonly owner: string;
  readonly name: string;
}

export interface RepoMeta {
  readonly stars: number;
  readonly description?: string;
  readonly pushedAt?: Date;
  readonly archived?: boolean;
  readonly license?: string;
  readonly topics?: readonly string[];
}

export type EngineStability = 'official' | 'unofficial';

export interface EngineDescriptor {
  readonly id: string;
  readonly name: string;
  /** Engine implementation type, used by the engine factory. */
  readonly type: string;
  readonly homepage?: string;
  readonly requiresAuth: boolean;
  /** `unofficial` engines use undocumented endpoints that may change without notice. */
  readonly stability: EngineStability;
}

export type SearchSort = 'stars' | 'relevance' | 'installs' | 'updated';

export interface SearchQuery {
  readonly text: string;
  readonly limit: number;
  readonly minStars?: number;
  /** Restrict to these engine ids; all enabled engines when omitted. */
  readonly engines?: readonly string[];
  readonly sort: SearchSort;
}

export interface SearchResult {
  /** `skill`: one skill. `repo`: a repository that may hold several skills. */
  readonly kind: 'skill' | 'repo';
  /** Engines that returned this result (several after merging). */
  readonly engineIds: readonly string[];
  readonly name: string;
  readonly description?: string;
  readonly url: string;
  readonly repo?: RepoRef;
  /** Path of the skill inside the repo, when the engine reports it. */
  readonly skillPath?: string;
  readonly stars?: number;
  readonly installs?: number;
  readonly updatedAt?: Date;
  readonly author?: string;
  /** Language of the description (e.g. `en`), when the engine reports it. */
  readonly language?: string;
  /** Relevance in [0, 1] from the engine's own order (1 = its first result). */
  readonly relevance?: number;
  readonly archived?: boolean;
  /** A skill with this name is already installed locally. */
  readonly installed?: boolean;
}

/** Per-engine outcome, so one failing engine never hides the others' results. */
export type EngineOutcome =
  | {
      readonly engineId: string;
      readonly ok: true;
      readonly count: number;
      readonly ms: number;
      readonly cached: boolean;
    }
  | { readonly engineId: string; readonly ok: false; readonly error: string; readonly ms: number };

export interface SearchReport {
  readonly query: SearchQuery;
  readonly results: readonly SearchResult[];
  readonly outcomes: readonly EngineOutcome[];
  /** Results found before the limit and filters were applied. */
  readonly totalFound: number;
  /** How many of `totalFound` the filters hid (`--min-stars`, archived repositories). */
  readonly filteredOut: number;
  /** Partial failures that did not stop the search (for example star enrichment). */
  readonly notes: readonly string[];
}

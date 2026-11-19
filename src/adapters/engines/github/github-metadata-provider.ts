import type { RepoMeta, RepoRef } from '../../../core/domain/search.js';
import type { Cache, HttpClient, SecretResolver } from '../../../core/ports/infrastructure.js';
import type { RepoMetadataProvider } from '../../../core/ports/search.js';
import { repoKey } from '../../../core/util/repo-ref.js';
import { githubRepo } from './github-schemas.js';
import { GITHUB_API, githubHeaders } from './github-engine.js';

export interface GithubMetadataOptions {
  readonly tokenRef?: string;
  /** At most this many repositories are looked up per search. */
  readonly maxRepos: number;
  readonly concurrency: number;
  readonly cacheTtlSeconds: number;
}

interface CachedMeta {
  stars: number;
  description?: string;
  pushedAt?: string;
  archived?: boolean;
  license?: string;
  topics?: string[];
}

const DEFAULTS: GithubMetadataOptions = { maxRepos: 30, concurrency: 6, cacheTtlSeconds: 86_400 };

/**
 * Stars and activity for repositories found by engines that do not report stars
 * (such as skills.sh), via `GET /repos/{owner}/{repo}`. Cached for a day.
 * A repository that cannot be read is left out; the result just has no stars.
 */
export class GithubMetadataProvider implements RepoMetadataProvider {
  private readonly options: GithubMetadataOptions;

  constructor(
    private readonly http: HttpClient,
    private readonly secrets: SecretResolver,
    private readonly cache: Cache,
    options: Partial<GithubMetadataOptions> = {},
  ) {
    this.options = { ...DEFAULTS, ...options };
  }

  async enrich(
    repos: readonly RepoRef[],
    signal: AbortSignal,
  ): Promise<ReadonlyMap<string, RepoMeta>> {
    const unique = new Map<string, RepoRef>();
    for (const r of repos) if (!unique.has(repoKey(r))) unique.set(repoKey(r), r);
    const todo = [...unique].slice(0, this.options.maxRepos);
    const out = new Map<string, RepoMeta>();
    const headers = await githubHeaders(this.secrets, this.options.tokenRef);
    let failures = 0;
    let lastError: unknown;

    let next = 0;
    const worker = async (): Promise<void> => {
      while (next < todo.length) {
        const item = todo[next++];
        if (!item) return;
        const [key, ref] = item;
        try {
          const meta = await this.lookup(key, ref, headers, signal);
          if (meta) out.set(key, meta);
        } catch (error) {
          failures += 1;
          lastError = error;
          if (signal.aborted) return;
        }
      }
    };
    await Promise.all(Array.from({ length: this.options.concurrency }, worker));
    if (failures > 0 && out.size === 0 && todo.length > 0) throw lastError;
    return out;
  }

  private async lookup(
    key: string,
    ref: RepoRef,
    headers: Record<string, string>,
    signal: AbortSignal,
  ): Promise<RepoMeta | undefined> {
    const cacheKey = `github-repo:${key}`;
    const cached = await this.cache.get<CachedMeta>(cacheKey);
    if (cached) return fromCache(cached);

    const url = `${GITHUB_API}/repos/${encodeURIComponent(ref.owner)}/${encodeURIComponent(ref.name)}`;
    const res = await this.http.getJson(url, { headers, signal });
    if (res.status === 404) return undefined;
    if (res.status === 403 || res.status === 429) {
      throw new Error('GitHub rate limit reached while adding stars');
    }
    const parsed = githubRepo.safeParse(res.json);
    if (res.status !== 200 || !parsed.success) return undefined;
    const r = parsed.data;
    const meta: CachedMeta = {
      stars: r.stargazers_count,
      topics: r.topics,
      archived: r.archived,
      ...(r.description ? { description: r.description } : {}),
      ...(r.pushed_at ? { pushedAt: r.pushed_at } : {}),
      ...(r.license?.spdx_id ? { license: r.license.spdx_id } : {}),
    };
    await this.cache.set(cacheKey, meta, this.options.cacheTtlSeconds);
    return fromCache(meta);
  }
}

function fromCache(m: CachedMeta): RepoMeta {
  return {
    stars: m.stars,
    ...(m.description ? { description: m.description } : {}),
    ...(m.pushedAt ? { pushedAt: new Date(m.pushedAt) } : {}),
    ...(m.archived ? { archived: true } : {}),
    ...(m.license ? { license: m.license } : {}),
    ...(m.topics ? { topics: m.topics } : {}),
  };
}

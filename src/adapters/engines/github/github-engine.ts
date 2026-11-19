import type { EngineDescriptor, SearchQuery, SearchResult } from '../../../core/domain/search.js';
import type { HttpClient, SecretResolver } from '../../../core/ports/infrastructure.js';
import type { SkillSearchEngine } from '../../../core/ports/search.js';
import { okJson, unexpectedShape } from '../http-errors.js';
import { githubSearch, type GithubRepo } from './github-schemas.js';

export const GITHUB_API = 'https://api.github.com';
export const GITHUB_HINT = 'set GITHUB_TOKEN or sign in with `gh auth login`';

export interface GithubEngineOptions {
  readonly id: string;
  /** Appended to the user's text, e.g. `claude skill` or `topic:claude-skills`. */
  readonly qualifiers: string;
  /** `${env:VAR}` reference; falls back to GITHUB_TOKEN / `gh auth token`. */
  readonly token?: string;
}

export async function githubHeaders(
  secrets: SecretResolver,
  tokenRef?: string,
): Promise<Record<string, string>> {
  const token = await secrets.githubToken(tokenRef);
  return {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

export function repoToResult(engineId: string, r: GithubRepo): SearchResult {
  return {
    kind: 'repo',
    engineIds: [engineId],
    name: r.full_name,
    url: r.html_url,
    repo: { owner: r.owner.login, name: r.name },
    stars: r.stargazers_count,
    author: r.owner.login,
    ...(r.description ? { description: r.description } : {}),
    ...(r.pushed_at ? { updatedAt: new Date(r.pushed_at) } : {}),
    ...(r.archived ? { archived: true } : {}),
  };
}

/** Repository search on GitHub, sorted by stars. Finds skill collections (repos). */
export class GithubEngine implements SkillSearchEngine {
  readonly descriptor: EngineDescriptor;

  constructor(
    private readonly http: HttpClient,
    private readonly secrets: SecretResolver,
    private readonly options: GithubEngineOptions,
  ) {
    this.descriptor = {
      id: options.id,
      name: 'GitHub',
      type: 'github',
      homepage: 'https://github.com/search',
      requiresAuth: false,
      stability: 'official',
    };
  }

  async search(query: SearchQuery, signal: AbortSignal): Promise<readonly SearchResult[]> {
    const q = `${query.text} ${this.options.qualifiers}`.trim();
    const params = new URLSearchParams({
      q,
      sort: 'stars',
      order: 'desc',
      per_page: String(Math.min(query.limit, 100)),
    });
    const res = await this.http.getJson(`${GITHUB_API}/search/repositories?${params.toString()}`, {
      headers: await githubHeaders(this.secrets, this.options.token),
      signal,
    });
    const parsed = githubSearch.safeParse(okJson(this.options.id, res, GITHUB_HINT));
    if (!parsed.success) unexpectedShape(this.options.id, parsed.error.issues[0]?.message);
    return parsed.data.items.map((r) => repoToResult(this.options.id, r));
  }
}

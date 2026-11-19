import type { EngineConfig } from '../../../core/config/schema.js';
import type { EngineDescriptor, SearchQuery, SearchResult } from '../../../core/domain/search.js';
import { EngineError } from '../../../core/errors.js';
import type { HttpClient, SecretResolver } from '../../../core/ports/infrastructure.js';
import type { SkillSearchEngine } from '../../../core/ports/search.js';
import { parseRepoRef } from '../../../core/util/repo-ref.js';
import { okJson, unexpectedShape } from '../http-errors.js';

type GenericConfig = Extract<EngineConfig, { type: 'generic-http' }>;

/** Reads `a.b.0.c` from a JSON value. */
export function readPath(value: unknown, path: string): unknown {
  let current: unknown = value;
  for (const part of path.split('.').filter(Boolean)) {
    if (current === null || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

const str = (v: unknown): string | undefined =>
  typeof v === 'string' && v.trim() ? v : typeof v === 'number' ? String(v) : undefined;
const num = (v: unknown): number | undefined => {
  const n = typeof v === 'string' ? Number(v) : v;
  return typeof n === 'number' && Number.isFinite(n) ? n : undefined;
};

/**
 * A registry described entirely in config: URL template, headers, where the result
 * list is, and which field holds name/url/description/repo/stars/installs.
 */
export class GenericHttpEngine implements SkillSearchEngine {
  readonly descriptor: EngineDescriptor;

  constructor(
    private readonly http: HttpClient,
    private readonly secrets: SecretResolver,
    private readonly config: GenericConfig,
  ) {
    this.descriptor = {
      id: config.id,
      name: config.name,
      type: 'generic-http',
      homepage: new URL(config.request.url.replace(/\{(query|limit)\}/g, 'x')).origin,
      requiresAuth: Object.values(config.request.headers).some((v) => v.includes('${env:')),
      stability: 'unofficial',
    };
  }

  async search(query: SearchQuery, signal: AbortSignal): Promise<readonly SearchResult[]> {
    const { request, response, id } = this.config;
    const url = request.url
      .replaceAll('{query}', encodeURIComponent(query.text))
      .replaceAll('{limit}', String(query.limit));
    const headers: Record<string, string> = {};
    for (const [name, value] of Object.entries(request.headers)) {
      const resolved = this.secrets.resolve(value);
      if (resolved === undefined) {
        throw new EngineError(
          id,
          `${id}: header ${name} uses an environment variable that is not set`,
        );
      }
      headers[name] = resolved;
    }

    const res = await this.http.getJson(url, { headers, signal });
    const items = readPath(okJson(id, res), response.items);
    if (!Array.isArray(items)) unexpectedShape(id, `no list at "${response.items}"`);

    const m = response.map;
    const results: SearchResult[] = [];
    for (const item of items) {
      const name = str(readPath(item, m.name));
      const link = str(readPath(item, m.url));
      if (!name || !link) continue;
      const description = m.description ? str(readPath(item, m.description)) : undefined;
      const repoUrl = m.repoUrl ? str(readPath(item, m.repoUrl)) : undefined;
      const repo = parseRepoRef(repoUrl ?? link);
      const stars = m.stars ? num(readPath(item, m.stars)) : undefined;
      const installs = m.installs ? num(readPath(item, m.installs)) : undefined;
      results.push({
        kind: 'skill',
        engineIds: [id],
        name,
        url: link,
        ...(repo ? { repo } : {}),
        ...(description ? { description } : {}),
        ...(stars === undefined ? {} : { stars }),
        ...(installs === undefined ? {} : { installs }),
      });
    }
    return results;
  }
}

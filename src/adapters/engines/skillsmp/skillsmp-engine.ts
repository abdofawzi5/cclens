import { z } from 'zod';
import type { EngineDescriptor, SearchQuery, SearchResult } from '../../../core/domain/search.js';
import type { HttpClient, SecretResolver } from '../../../core/ports/infrastructure.js';
import type { SkillSearchEngine } from '../../../core/ports/search.js';
import { parseRepoRef } from '../../../core/util/repo-ref.js';
import { okJson, unexpectedShape } from '../http-errors.js';

const response = z.looseObject({
  data: z.looseObject({
    skills: z.array(
      z.looseObject({
        name: z.string(),
        author: z.string().nullish(),
        description: z.string().nullish(),
        contentLanguage: z.string().nullish(),
        githubUrl: z.string().nullish(),
        skillUrl: z.string(),
        stars: z.number().nullish(),
        updatedAt: z.number().nullish(),
      }),
    ),
  }),
});

/** `https://github.com/o/r/tree/main/a/b` → `a/b`. */
export function skillPathFromGithubUrl(url: string): string | undefined {
  const m = /github\.com\/[^/]+\/[^/]+\/(?:tree|blob)\/[^/]+\/(.+?)\/?$/.exec(url);
  return m?.[1]?.replace(/\/SKILL\.md$/i, '');
}

export interface SkillsMpOptions {
  readonly id: string;
  readonly baseUrl: string;
  readonly apiKey?: string;
}

/** SkillsMP marketplace search (official API; stars are the source repository's). */
export class SkillsMpEngine implements SkillSearchEngine {
  readonly descriptor: EngineDescriptor;

  constructor(
    private readonly http: HttpClient,
    private readonly secrets: SecretResolver,
    private readonly options: SkillsMpOptions,
  ) {
    this.descriptor = {
      id: options.id,
      name: 'SkillsMP',
      type: 'skillsmp',
      homepage: 'https://skillsmp.com',
      requiresAuth: false,
      stability: 'official',
    };
  }

  async search(query: SearchQuery, signal: AbortSignal): Promise<readonly SearchResult[]> {
    const params = new URLSearchParams({
      q: query.text,
      limit: String(Math.min(query.limit, 100)),
      sortBy: 'stars',
    });
    const key = this.options.apiKey ? this.secrets.resolve(this.options.apiKey) : undefined;
    const res = await this.http.getJson(
      `${this.options.baseUrl.replace(/\/$/, '')}/skills/search?${params.toString()}`,
      { headers: key ? { Authorization: `Bearer ${key}` } : {}, signal },
    );
    const parsed = response.safeParse(okJson(this.options.id, res));
    if (!parsed.success) unexpectedShape(this.options.id, parsed.error.issues[0]?.message);

    return parsed.data.data.skills.map((s): SearchResult => {
      const repo = s.githubUrl ? parseRepoRef(s.githubUrl) : undefined;
      const skillPath = s.githubUrl ? skillPathFromGithubUrl(s.githubUrl) : undefined;
      return {
        kind: 'skill',
        engineIds: [this.options.id],
        name: s.name,
        url: s.skillUrl,
        ...(repo ? { repo } : {}),
        ...(skillPath ? { skillPath } : {}),
        ...(s.description ? { description: s.description } : {}),
        ...(s.author ? { author: s.author } : {}),
        ...(s.contentLanguage ? { language: s.contentLanguage } : {}),
        ...(typeof s.stars === 'number' ? { stars: s.stars } : {}),
        ...(typeof s.updatedAt === 'number' ? { updatedAt: new Date(s.updatedAt * 1000) } : {}),
      };
    });
  }
}

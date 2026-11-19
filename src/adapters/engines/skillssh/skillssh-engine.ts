import { z } from 'zod';
import type { EngineDescriptor, SearchQuery, SearchResult } from '../../../core/domain/search.js';
import type { HttpClient } from '../../../core/ports/infrastructure.js';
import type { SkillSearchEngine } from '../../../core/ports/search.js';
import { parseRepoRef } from '../../../core/util/repo-ref.js';
import { okJson, unexpectedShape } from '../http-errors.js';

const response = z.looseObject({
  skills: z.array(
    z.looseObject({
      id: z.string(),
      source: z.string(),
      skillId: z.string().optional(),
      name: z.string(),
      installs: z.number().nullish(),
    }),
  ),
});

export interface SkillsShOptions {
  readonly id: string;
  readonly baseUrl: string;
}

/**
 * skills.sh search through its public, undocumented endpoint (`/api/search`).
 * Reports install counts but no stars; the search service adds stars from GitHub.
 * Marked `unofficial`: it may change without notice (ADR 0003).
 */
export class SkillsShEngine implements SkillSearchEngine {
  readonly descriptor: EngineDescriptor;

  constructor(
    private readonly http: HttpClient,
    private readonly options: SkillsShOptions,
  ) {
    this.descriptor = {
      id: options.id,
      name: 'skills.sh',
      type: 'skillssh',
      homepage: 'https://skills.sh',
      requiresAuth: false,
      stability: 'unofficial',
    };
  }

  async search(query: SearchQuery, signal: AbortSignal): Promise<readonly SearchResult[]> {
    const base = this.options.baseUrl.replace(/\/$/, '');
    const params = new URLSearchParams({
      q: query.text,
      limit: String(Math.min(query.limit, 100)),
    });
    const res = await this.http.getJson(`${base}/api/search?${params.toString()}`, { signal });
    const parsed = response.safeParse(okJson(this.options.id, res));
    if (!parsed.success) unexpectedShape(this.options.id, parsed.error.issues[0]?.message);

    return parsed.data.skills.map((s): SearchResult => {
      const repo = parseRepoRef(s.source);
      return {
        kind: 'skill',
        engineIds: [this.options.id],
        name: s.name,
        url: `${base}/${s.id}`,
        ...(repo ? { repo, author: repo.owner } : {}),
        ...(typeof s.installs === 'number' ? { installs: s.installs } : {}),
      };
    });
  }
}

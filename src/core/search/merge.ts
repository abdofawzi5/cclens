import type { SearchResult } from '../domain/search.js';
import { repoKey } from '../util/repo-ref.js';

/**
 * Identity of a result across engines: a repository, a skill inside a repository,
 * or (when no repository is known) its URL.
 */
export function resultKey(r: SearchResult): string {
  if (r.repo && r.kind === 'repo') return `repo:${repoKey(r.repo)}`;
  if (r.repo) return `skill:${repoKey(r.repo)}#${r.name.toLowerCase()}`;
  return `url:${r.url.toLowerCase()}`;
}

/**
 * Which copy's text (description, link, path, language) to show: one with a
 * description beats one without; English beats unknown, which beats other languages.
 */
function textRank(r: SearchResult): number {
  if (r.description === undefined) return -1;
  if (r.language === undefined) return 1;
  return r.language.toLowerCase().startsWith('en') ? 2 : 0;
}

function maxOf(a?: number, b?: number): number | undefined {
  if (a === undefined) return b;
  if (b === undefined) return a;
  return Math.max(a, b);
}

function merge(a: SearchResult, b: SearchResult): SearchResult {
  const text = textRank(b) > textRank(a) ? b : a;
  const updatedAt =
    a.updatedAt && b.updatedAt
      ? a.updatedAt > b.updatedAt
        ? a.updatedAt
        : b.updatedAt
      : (a.updatedAt ?? b.updatedAt);
  const description = text.description ?? a.description ?? b.description;
  const author = a.author ?? b.author;
  const skillPath = text.skillPath ?? a.skillPath ?? b.skillPath;
  const language = text.language;
  const stars = maxOf(a.stars, b.stars);
  const installs = maxOf(a.installs, b.installs);
  const relevance = maxOf(a.relevance, b.relevance);
  return {
    kind: a.kind,
    engineIds: [...new Set([...a.engineIds, ...b.engineIds])],
    name: a.name,
    url: text.url,
    ...(a.repo ? { repo: a.repo } : {}),
    ...(description === undefined ? {} : { description }),
    ...(skillPath === undefined ? {} : { skillPath }),
    ...(stars === undefined ? {} : { stars }),
    ...(installs === undefined ? {} : { installs }),
    ...(updatedAt === undefined ? {} : { updatedAt }),
    ...(author === undefined ? {} : { author }),
    ...(language === undefined ? {} : { language }),
    ...(relevance === undefined ? {} : { relevance }),
    ...(a.archived || b.archived ? { archived: true } : {}),
  };
}

/**
 * Merges results that point at the same repository or skill (across engines, and
 * translated copies within one engine). Order of first appearance is kept.
 */
export function mergeResults(results: readonly SearchResult[]): SearchResult[] {
  const byKey = new Map<string, SearchResult>();
  for (const r of results) {
    const key = resultKey(r);
    const existing = byKey.get(key);
    byKey.set(key, existing ? merge(existing, r) : r);
  }
  return [...byKey.values()];
}

/** Adds `relevance` from each engine's own order: its first result scores 1. */
export function withPositionRelevance(results: readonly SearchResult[]): SearchResult[] {
  return results.map((r, i) => ({
    ...r,
    relevance: r.relevance ?? (results.length <= 1 ? 1 : 1 - i / results.length),
  }));
}

import type { SearchQuery, SearchResult, SearchSort } from '../domain/search.js';
import type { RankingStrategy } from '../ports/search.js';

type Compare = (a: SearchResult, b: SearchResult) => number;

/** Lowercase words of the query (2+ characters), without duplicates. */
export function queryTerms(text: string): string[] {
  const words = text.toLowerCase().split(/[^\p{L}\p{N}]+/u);
  return [...new Set(words.filter((t) => t.length >= 2))];
}

/**
 * How many query words a result mentions in its name, path, repository or description.
 * Ranking groups by this first, so a popular but loosely related skill never
 * outranks one that matches the whole query.
 */
export function matchedTerms(r: SearchResult, terms: readonly string[]): number {
  const repo = r.repo ? `${r.repo.owner}/${r.repo.name}` : '';
  const haystack = [r.name, r.skillPath ?? '', repo, r.description ?? '']
    .join(' ')
    .toLowerCase()
    .replace(/[-_/]+/g, ' ');
  return terms.filter((t) => haystack.includes(t)).length;
}

const desc =
  (value: (r: SearchResult) => number | undefined): Compare =>
  (a, b) =>
    (value(b) ?? -1) - (value(a) ?? -1);

const chain =
  (...comparers: Compare[]): Compare =>
  (a, b) => {
    for (const c of comparers) {
      const d = c(a, b);
      if (d !== 0) return d;
    }
    return a.name.localeCompare(b.name);
  };

const stars = desc((r) => r.stars);
const installs = desc((r) => r.installs);
const updated = desc((r) => r.updatedAt?.getTime());
/** Relevance, with a small bonus for each extra engine that found the same result. */
const relevance = desc((r) => (r.relevance ?? 0) + 0.1 * (r.engineIds.length - 1));

/** Sorts by matched query words first, then by the strategy's own order. */
class ComparatorRanking implements RankingStrategy {
  constructor(
    readonly id: SearchSort,
    private readonly compare: Compare,
  ) {}

  rank(results: readonly SearchResult[], query: SearchQuery): readonly SearchResult[] {
    const terms = queryTerms(query.text);
    const matches = new Map(results.map((r) => [r, matchedTerms(r, terms)]));
    const byMatch: Compare = (a, b) => (matches.get(b) ?? 0) - (matches.get(a) ?? 0);
    return [...results].sort(chain(byMatch, this.compare));
  }
}

/** One strategy per sort option (Strategy + Registry). */
export const RANKINGS: Readonly<Record<SearchSort, RankingStrategy>> = {
  stars: new ComparatorRanking('stars', chain(stars, installs, relevance)),
  installs: new ComparatorRanking('installs', chain(installs, stars, relevance)),
  updated: new ComparatorRanking('updated', chain(updated, stars)),
  relevance: new ComparatorRanking('relevance', chain(relevance, stars, installs)),
};

export const SEARCH_SORTS = Object.keys(RANKINGS) as SearchSort[];

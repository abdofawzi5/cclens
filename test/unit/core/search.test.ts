import { describe, expect, it } from 'vitest';
import type { SearchQuery, SearchResult } from '../../../src/core/domain/search.js';
import { mergeResults, resultKey, withPositionRelevance } from '../../../src/core/search/merge.js';
import {
  matchedTerms,
  queryTerms,
  RANKINGS,
  SEARCH_SORTS,
} from '../../../src/core/search/ranking.js';

const r = (p: Partial<SearchResult> & { name: string }): SearchResult => ({
  kind: 'skill',
  engineIds: ['e'],
  url: `https://x.test/${p.name}`,
  ...p,
});
const repo = { owner: 'Acme', name: 'Skills' };

describe('resultKey and mergeResults', () => {
  it('keys repos, skills in repos and plain URLs', () => {
    expect(resultKey(r({ name: 'Acme/Skills', kind: 'repo', repo }))).toBe('repo:acme/skills');
    expect(resultKey(r({ name: 'SEO', repo }))).toBe('skill:acme/skills#seo');
    expect(resultKey(r({ name: 'x', url: 'HTTPS://X.test/A' }))).toBe('url:https://x.test/a');
  });

  it('merges the same skill across engines and translations, preferring English text', () => {
    const merged = mergeResults([
      r({
        name: 'seo',
        repo,
        engineIds: ['skillsmp'],
        language: 'ja',
        description: 'ja text',
        url: 'https://mp/ja',
        skillPath: 'docs/ja/seo',
        stars: 10,
        updatedAt: new Date('2026-01-01'),
      }),
      r({ name: 'seo', repo, engineIds: ['skillssh'], installs: 99, relevance: 0.5 }),
      r({
        name: 'SEO',
        repo: { owner: 'acme', name: 'skills' },
        engineIds: ['skillsmp'],
        language: 'en',
        description: 'en text',
        url: 'https://mp/en',
        skillPath: 'skills/seo',
        stars: 12,
        updatedAt: new Date('2026-02-01'),
        author: 'acme',
        archived: true,
      }),
      r({ name: 'other', repo }),
    ]);
    expect(merged).toHaveLength(2);
    expect(merged[0]).toEqual({
      kind: 'skill',
      engineIds: ['skillsmp', 'skillssh'],
      name: 'seo',
      url: 'https://mp/en',
      repo,
      description: 'en text',
      skillPath: 'skills/seo',
      stars: 12,
      installs: 99,
      updatedAt: new Date('2026-02-01'),
      author: 'acme',
      language: 'en',
      relevance: 0.5,
      archived: true,
    });
  });

  it('keeps the first text when both are preferred and fills gaps from either side', () => {
    const [m] = mergeResults([
      r({ name: 'a', repo, updatedAt: new Date('2026-03-01') }),
      r({ name: 'a', repo, description: 'later', updatedAt: new Date('2026-01-01') }),
    ]);
    expect(m).toMatchObject({
      url: 'https://x.test/a',
      description: 'later',
      updatedAt: new Date('2026-03-01'),
    });
    const [n] = mergeResults([
      r({ name: 'b', repo }),
      r({ name: 'b', repo, updatedAt: new Date('2026-01-01') }),
    ]);
    expect(n?.updatedAt).toEqual(new Date('2026-01-01'));
  });

  it('scores relevance from engine order', () => {
    expect(
      withPositionRelevance([r({ name: 'a' }), r({ name: 'b' })]).map((x) => x.relevance),
    ).toEqual([1, 0.5]);
    expect(withPositionRelevance([r({ name: 'a' })])[0]?.relevance).toBe(1);
    expect(withPositionRelevance([r({ name: 'a', relevance: 0.2 })])[0]?.relevance).toBe(0.2);
  });
});

describe('ranking', () => {
  const q = (text: string, sort: SearchQuery['sort']): SearchQuery => ({ text, sort, limit: 10 });

  it('splits query words and counts matches across name, path, repo and description', () => {
    expect(queryTerms('SEO audit, a seo!')).toEqual(['seo', 'audit']);
    const hit = r({ name: 'seo-audit', repo, description: 'x' });
    expect(matchedTerms(hit, ['seo', 'audit', 'acme', 'zzz'])).toBe(3);
    expect(matchedTerms(r({ name: 'x', skillPath: 'tools/pdf_kit' }), ['pdf'])).toBe(1);
  });

  it('puts full matches first, then sorts by the chosen order', () => {
    const results = [
      r({ name: 'popular-unrelated', description: 'seo things', stars: 900 }),
      r({ name: 'seo-audit', stars: 10, installs: 5 }),
      r({ name: 'seo-audit-pro', stars: 50, installs: 1 }),
    ];
    expect(RANKINGS.stars.rank(results, q('seo audit', 'stars')).map((x) => x.name)).toEqual([
      'seo-audit-pro',
      'seo-audit',
      'popular-unrelated',
    ]);
    expect(RANKINGS.installs.rank(results, q('seo audit', 'installs')).map((x) => x.name)).toEqual([
      'seo-audit',
      'seo-audit-pro',
      'popular-unrelated',
    ]);
  });

  it('sorts by update time, relevance and name as a last resort', () => {
    const results = [
      r({ name: 'b', updatedAt: new Date('2026-01-01'), relevance: 0.9 }),
      r({
        name: 'a',
        updatedAt: new Date('2026-05-01'),
        relevance: 0.5,
        engineIds: ['x', 'y', 'z', 'w', 'v'],
      }),
      r({ name: 'c' }),
      r({ name: 'aa' }),
    ];
    expect(RANKINGS.updated.rank(results, q('q', 'updated')).map((x) => x.name)).toEqual([
      'a',
      'b',
      'aa',
      'c',
    ]);
    expect(RANKINGS.relevance.rank(results, q('q', 'relevance')).map((x) => x.name)).toEqual([
      'a',
      'b',
      'aa',
      'c',
    ]);
    expect(SEARCH_SORTS).toEqual(['stars', 'installs', 'updated', 'relevance']);
  });
});

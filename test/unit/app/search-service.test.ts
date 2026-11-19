import { describe, expect, it } from 'vitest';
import { ConfigService } from '../../../src/app/config-service.js';
import { CachingEngine, TimeoutEngine } from '../../../src/app/search/engine-decorators.js';
import { EngineService } from '../../../src/app/search/engine-service.js';
import { SearchService, type SearchDeps } from '../../../src/app/search/search-service.js';
import { configSchema, type EngineConfig } from '../../../src/core/config/schema.js';
import type {
  EngineDescriptor,
  RepoMeta,
  SearchQuery,
  SearchResult,
} from '../../../src/core/domain/search.js';
import type { EngineFactory, SkillSearchEngine } from '../../../src/core/ports/search.js';
import { FixedClock } from '../../support/fakes.js';
import { MemoryCache } from '../../support/fake-http.js';
import { InMemoryConfigStore } from '../../support/in-memory-config-store.js';

const descriptor = (id: string): EngineDescriptor => ({
  id,
  name: id,
  type: 'fake',
  requiresAuth: false,
  stability: 'official',
});

class FakeEngine implements SkillSearchEngine {
  calls: SearchQuery[] = [];
  readonly descriptor: EngineDescriptor;
  constructor(
    id: string,
    private readonly behaviour: SearchResult[] | Error | 'hang',
  ) {
    this.descriptor = descriptor(id);
  }
  search(query: SearchQuery, signal: AbortSignal): Promise<readonly SearchResult[]> {
    this.calls.push(query);
    if (this.behaviour === 'hang') {
      return new Promise((_, reject) => {
        signal.addEventListener('abort', () => {
          reject(new Error('aborted'));
        });
      });
    }
    return this.behaviour instanceof Error
      ? Promise.reject(this.behaviour)
      : Promise.resolve(this.behaviour);
  }
}

const res = (name: string, p: Partial<SearchResult> = {}): SearchResult => ({
  kind: 'skill',
  engineIds: ['x'],
  name,
  url: `https://x.test/${name}`,
  ...p,
});
const q: SearchQuery = { text: 'Seo ', limit: 5, sort: 'stars' };
const never = new AbortController().signal;

describe('engine decorators', () => {
  it('times out slow engines with a clear message, passes other errors through', async () => {
    await expect(
      new TimeoutEngine(new FakeEngine('slow', 'hang'), 20).search(q, never),
    ).rejects.toThrow('slow: no answer within 0.02s');
    await expect(
      new TimeoutEngine(new FakeEngine('bad', new Error('boom')), 1000).search(q, never),
    ).rejects.toThrow('boom');
    expect(new TimeoutEngine(new FakeEngine('id', []), 1).descriptor.id).toBe('id');
  });

  it('caches per engine and query, restores dates, and can refresh', async () => {
    const inner = new FakeEngine('e', [
      res('a', { updatedAt: new Date('2026-01-02T00:00:00Z') }),
      res('b'),
    ]);
    const cache = new MemoryCache();
    const hits: string[] = [];
    const cached = new CachingEngine(inner, cache, {
      ttlSeconds: 60,
      refresh: false,
      onHit: (id) => hits.push(id),
    });
    await cached.search(q, never);
    const second = await cached.search({ ...q, text: 'seo' }, never);
    expect(inner.calls).toHaveLength(1);
    expect(hits).toEqual(['e']);
    expect(second[0]?.updatedAt).toEqual(new Date('2026-01-02T00:00:00Z'));
    expect(second[1]).not.toHaveProperty('updatedAt');

    await new CachingEngine(inner, cache, { ttlSeconds: 60, refresh: true }).search(q, never);
    await new CachingEngine(inner, cache, { ttlSeconds: 0, refresh: false }).search(q, never);
    expect(inner.calls).toHaveLength(3);
    expect(new CachingEngine(inner, cache, { ttlSeconds: 1, refresh: false }).descriptor.id).toBe(
      'e',
    );
  });
});

function setup(
  engines: Record<string, FakeEngine>,
  over: Partial<SearchDeps> = {},
  configEngines?: unknown[],
) {
  const store = new InMemoryConfigStore();
  const config = configSchema.parse({
    version: 1,
    engines: configEngines ?? [
      { id: 'one', type: 'skillssh' },
      { id: 'two', type: 'skillssh' },
      { id: 'off', type: 'skillssh', enabled: false },
    ],
  });
  void store.save(config);
  const factory: EngineFactory = {
    types: ['skillssh'],
    create: (c: EngineConfig) => engines[c.id] ?? new FakeEngine(c.id, []),
  };
  const configService = new ConfigService(store);
  const search = new SearchService({
    config: configService,
    factory,
    cache: new MemoryCache(),
    clock: new FixedClock(),
    ...over,
  });
  return { search, engines: new EngineService(configService, factory, search), configService };
}

describe('SearchService', () => {
  it('queries enabled engines, merges, ranks and reports outcomes', async () => {
    const one = new FakeEngine('one', [
      res('seo-audit', { engineIds: ['one'], repo: { owner: 'o', name: 'r' }, stars: 5 }),
      res('seo-two', { engineIds: ['one'], stars: 50 }),
    ]);
    const two = new FakeEngine('two', [
      res('seo-audit', { engineIds: ['two'], repo: { owner: 'o', name: 'r' }, installs: 9 }),
    ]);
    const { search } = setup({ one, two, off: new FakeEngine('off', [res('hidden')]) });
    const report = await search.search('  seo ');
    expect(one.calls[0]).toMatchObject({ text: 'seo', limit: 20, sort: 'stars' });
    expect(report.query).toEqual({ text: 'seo', limit: 20, sort: 'stars', minStars: 0 });
    expect(report.results.map((r) => [r.name, r.engineIds, r.stars, r.installs])).toEqual([
      ['seo-two', ['one'], 50, undefined],
      ['seo-audit', ['one', 'two'], 5, 9],
    ]);
    expect(report.outcomes.map((o) => [o.engineId, o.ok])).toEqual([
      ['one', true],
      ['two', true],
    ]);
    expect(report.totalFound).toBe(2);
    expect(report.notes).toEqual([]);
  });

  it('uses only the requested engines, even disabled ones, and rejects unknown ids', async () => {
    const off = new FakeEngine('off', [res('hidden')]);
    const { search } = setup({ off });
    const report = await search.search('x', { engines: ['off'], limit: 1, sort: 'relevance' });
    expect(report.results.map((r) => r.name)).toEqual(['hidden']);
    await expect(search.search('x', { engines: ['nope'] })).rejects.toThrow(
      /Unknown engine "nope". Known engines: one, two, off/,
    );
  });

  it('explains empty queries and when no engine is enabled', async () => {
    const { search } = setup({});
    await expect(search.search('  ')).rejects.toThrow(/Give something to search for/);
    const none = setup({}, {}, [{ id: 'a', type: 'skillssh', enabled: false }]);
    await expect(none.search.search('x')).rejects.toThrow(/No search engines are enabled/);
  });

  it('turns a failing engine into an outcome and keeps the others', async () => {
    const { search } = setup({
      one: new FakeEngine('one', new Error('HTTP 500')),
      two: new FakeEngine('two', [res('ok')]),
    });
    const report = await search.search('ok');
    expect(report.outcomes[0]).toMatchObject({ engineId: 'one', ok: false, error: 'HTTP 500' });
    expect(report.results.map((r) => r.name)).toEqual(['ok']);
  });

  it('adds GitHub stars, filters archived and low-star results, marks installed names', async () => {
    const one = new FakeEngine('one', [
      res('Seo-Audit', { repo: { owner: 'o', name: 'r' } }),
      res('old', { repo: { owner: 'old', name: 'r' } }),
      res('tiny', { repo: { owner: 't', name: 'r' } }),
      res('nostars'),
    ]);
    const meta = new Map<string, RepoMeta>([
      ['o/r', { stars: 500, description: 'from github', pushedAt: new Date('2026-01-01') }],
      ['old/r', { stars: 900, archived: true }],
      ['t/r', { stars: 2 }],
    ]);
    const { search } = setup(
      { one },
      {
        metadata: { enrich: () => Promise.resolve(meta) },
        skills: {
          id: 's',
          list: () =>
            Promise.resolve([{ id: 'mkt:seo-audit', name: 'seo-audit', scope: 'plugin' as const }]),
        },
      },
    );
    const report = await search.search('seo', { minStars: 10, engines: ['one'] });
    expect(report.results).toEqual([
      expect.objectContaining({
        name: 'Seo-Audit',
        stars: 500,
        description: 'from github',
        updatedAt: new Date('2026-01-01'),
        installed: true,
      }),
    ]);
    expect(report.totalFound).toBe(4);
    const withArchived = await search.search('seo', { includeArchived: true, engines: ['one'] });
    expect(withArchived.results.map((r) => r.name)).toContain('old');
  });

  it('notes enrichment failures and ignores a failing skill list', async () => {
    const one = new FakeEngine('one', [res('a', { repo: { owner: 'o', name: 'r' } })]);
    const { search } = setup(
      { one },
      {
        metadata: { enrich: () => Promise.reject(new Error('rate limit')) },
        skills: { id: 's', list: () => Promise.reject(new Error('disk')) },
      },
    );
    const report = await search.search('a', { engines: ['one'] });
    expect(report.notes).toEqual(['Could not add GitHub stars: rate limit']);
    expect(report.results[0]).not.toHaveProperty('installed');
  });
});

describe('EngineService', () => {
  const generic = {
    id: 'mine',
    type: 'generic-http',
    name: 'Mine',
    request: { url: 'https://reg.test/?q={query}' },
    response: { items: 'items', map: { name: 'n', url: 'u' } },
  };

  it('lists engines with descriptors, toggles, adds and removes them', async () => {
    const { engines, configService } = setup({});
    expect((await engines.list()).map((r) => [r.config.id, r.descriptor?.id])).toEqual([
      ['one', 'one'],
      ['two', 'two'],
      ['off', 'off'],
    ]);
    await engines.setEnabled('off', true);
    expect((await configService.engines()).find((e) => e.id === 'off')?.enabled).toBe(true);

    const added = await engines.add(generic);
    expect(added).toMatchObject({ id: 'mine', enabled: true, timeoutMs: 8000 });
    await expect(engines.add(generic)).rejects.toThrow(/already exists/);
    await expect(engines.add({ id: 'Bad Id', type: 'github' })).rejects.toThrow(
      /Invalid engine definition:\n {2}id:/,
    );
    await expect(engines.add(null)).rejects.toThrow(/\(root\)/);

    await engines.remove('mine');
    expect((await configService.engines()).map((e) => e.id)).not.toContain('mine');
    await expect(engines.remove('mine')).rejects.toThrow(/Unknown engine "mine"/);
  });

  it('lists an engine whose factory fails without a descriptor', async () => {
    const store = new InMemoryConfigStore();
    const configService = new ConfigService(store);
    const factory: EngineFactory = {
      types: [],
      create: () => {
        throw new Error('nope');
      },
    };
    const search = new SearchService({
      config: configService,
      factory,
      cache: new MemoryCache(),
      clock: new FixedClock(),
    });
    const rows = await new EngineService(configService, factory, search).list();
    expect(rows[0]).not.toHaveProperty('descriptor');
  });

  it('tests engines live, bypassing the cache', async () => {
    const one = new FakeEngine('one', [res('seo')]);
    const { engines } = setup({ one });
    expect((await engines.test('one')).map((o) => [o.engineId, o.ok])).toEqual([['one', true]]);
    expect(one.calls[0]?.text).toBe('seo');
    expect((await engines.test()).map((o) => o.engineId)).toEqual(['one', 'two']);
  });
});

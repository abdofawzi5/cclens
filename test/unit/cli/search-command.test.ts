import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { stripVTControlCharacters as strip } from 'node:util';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resolvePaths } from '../../../src/adapters/system/paths.js';
import { createContainer } from '../../../src/composition-root.js';
import type { SearchReport } from '../../../src/core/domain/search.js';
import { buildProgram } from '../../../src/interfaces/cli/program.js';
import { SearchRenderer } from '../../../src/interfaces/render/search-renderer.js';
import { MemoryEventStore } from '../../support/fakes.js';
import {
  engineFixture,
  FakeHttp,
  FixedSecrets,
  json,
  MemoryCache,
} from '../../support/fake-http.js';
import { InMemoryConfigStore } from '../../support/in-memory-config-store.js';

function container(http: FakeHttp, configStore = new InMemoryConfigStore()) {
  return createContainer({
    overrides: {
      paths: resolvePaths({}, '/Users/me'),
      configStore,
      eventStore: new MemoryEventStore(),
      http,
      secrets: new FixedSecrets(),
      cache: new MemoryCache(),
      skillSource: { id: 'none', list: () => Promise.resolve([]) },
    },
  });
}

async function run(
  args: string[],
  http = liveLike(),
  store?: InMemoryConfigStore,
): Promise<string> {
  const lines: string[] = [];
  await buildProgram(container(http, store), '1.0.0', (t) => lines.push(t))
    .exitOverride()
    .parseAsync(['node', 'cclens', ...args]);
  return strip(lines.join('\n'));
}

function liveLike(): FakeHttp {
  return new FakeHttp()
    .route(/api\.github\.com\/search/, json(engineFixture('github-search-repos.json')))
    .route(
      /api\.github\.com\/repos\/coreyhaines31\/marketingskills/,
      json({
        full_name: 'coreyhaines31/marketingskills',
        name: 'marketingskills',
        owner: { login: 'coreyhaines31' },
        html_url: 'https://github.com/coreyhaines31/marketingskills',
        stargazers_count: 61438,
      }),
    )
    .route(/skillsmp\.com/, json(engineFixture('skillsmp-search.json')))
    .route(/skills\.sh\/api\/search/, json(engineFixture('skillssh-search.json')));
}

describe('search command', () => {
  it('searches every engine and prints merged, ranked results', async () => {
    const out = await run(['search', 'seo', 'audit', '--limit', '3']);
    expect(out).toMatch(/1\. seo-audit {2}coreyhaines31\/marketingskills {2}★ 61\.4K {2}↓ 259\.5K/);
    expect(out).toContain(
      'https://skills.sh/coreyhaines31/marketingskills/seo-audit  via skillssh',
    );
    expect(out).toMatch(/Showing 3 of \d+ after merging duplicates, sorted by stars\./);
    expect(out).toMatch(/✔ github: 2 results, \d+ ms/);
    expect(out).toContain('✔ skillssh (unofficial): 2 results');
  });

  it('supports engine selection, sorting and JSON', async () => {
    const json = JSON.parse(
      await run([
        '--json',
        'search',
        'seo',
        '--engine',
        'skillssh',
        '--sort',
        'installs',
        '--min-stars',
        '0',
        '--refresh',
        '--archived',
      ]),
    ) as SearchReport;
    expect(json.query).toMatchObject({ text: 'seo', sort: 'installs', engines: ['skillssh'] });
    expect(json.outcomes.map((o) => o.engineId)).toEqual(['skillssh']);
    expect(json.results[0]?.name).toBe('seo-audit');
  });
});

describe('engines command', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'cclens-engines-'));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('lists, disables, adds, tests and removes engines', async () => {
    const store = new InMemoryConfigStore();
    expect(await run(['engines'], undefined, store)).toMatch(
      /skillssh\s+│ yes\s+│ skills\.sh\s+│ unofficial/,
    );
    expect(await run(['engines', 'disable', 'github'], undefined, store)).toBe('github disabled.');
    expect(await run(['engines', 'list'], undefined, store)).toMatch(/github\s+│ no/);
    expect(await run(['engines', 'enable', 'github'], undefined, store)).toBe('github enabled.');

    const file = join(dir, 'engine.json');
    await writeFile(
      file,
      JSON.stringify({
        id: 'mine',
        type: 'generic-http',
        name: 'Mine',
        request: { url: 'https://reg.test/?q={query}' },
        response: { items: 'items', map: { name: 'n', url: 'u' } },
      }),
    );
    expect(await run(['engines', 'add', file], undefined, store)).toContain('Added mine');
    const http = liveLike().route(
      /reg\.test/,
      json({ items: [{ n: 'seo', u: 'https://reg.test/seo' }] }),
    );
    expect(await run(['engines', 'test', 'mine'], http, store)).toMatch(
      /✔ mine \(unofficial\): 1 results/,
    );
    expect(await run(['engines', 'remove', 'mine'], undefined, store)).toBe('mine removed.');

    const bad = join(dir, 'bad.json');
    await writeFile(bad, '{ nope');
    await expect(run(['engines', 'add', bad], undefined, store)).rejects.toThrow(
      /Could not read .* as JSON/,
    );
  });

  it('reports failing engines in test output and JSON', async () => {
    const down = new FakeHttp();
    const out = await run(['engines', 'test', 'skillsmp'], down);
    expect(out).toContain('✖ skillsmp: skillsmp: HTTP 404');
    process.exitCode = 0;
    const json = JSON.parse(await run(['--json', 'engines', 'test', 'skillssh'], down)) as {
      ok: boolean;
    }[];
    expect(json[0]?.ok).toBe(false);
  });
});

describe('SearchRenderer', () => {
  it('shows empty results, repo kind, flags and notes', () => {
    const base: SearchReport = {
      query: { text: 'zzz', limit: 5, sort: 'stars' },
      results: [],
      outcomes: [],
      totalFound: 0,
      filteredOut: 0,
      notes: ['Could not add GitHub stars: x'],
    };
    const empty = strip(new SearchRenderer().render(base));
    expect(empty).toContain('No skills found for "zzz".');
    expect(empty).toContain('! Could not add GitHub stars: x');
    expect(empty).toContain('Showing 0 of 0 after merging duplicates, sorted by stars.');
    expect(empty).not.toContain('hidden');

    const full = strip(
      new SearchRenderer(new Set(), 60).render({
        ...base,
        results: [
          {
            kind: 'repo',
            engineIds: ['github'],
            name: 'o/r',
            url: 'https://github.com/o/r',
            archived: true,
            description: 'd'.repeat(300),
          },
          { kind: 'skill', engineIds: ['x'], name: 'pdf', url: 'https://x/pdf', installed: true },
        ],
        outcomes: [{ engineId: 'github', ok: true, count: 1, ms: 5, cached: true }],
      }),
    );
    expect(full).toContain('1. o/r  (repo)  archived');
    expect(full).toContain('…');
    expect(full).toContain('2. pdf  ✔ same name installed');
    expect(full).toContain('✔ github: 1 results, cached');

    const filtered = strip(
      new SearchRenderer(new Set(), 200).render({ ...base, totalFound: 200, filteredOut: 189 }),
    );
    expect(filtered).toContain(
      'Showing 0 of 11 after merging duplicates (189 more hidden by --min-stars or because they are archived), sorted by stars.',
    );
  });
});

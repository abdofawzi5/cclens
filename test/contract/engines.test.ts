import { describe, expect, it } from 'vitest';
import { DefaultEngineFactory } from '../../src/adapters/engines/engine-factory.js';
import {
  GenericHttpEngine,
  readPath,
} from '../../src/adapters/engines/generic-http/generic-http-engine.js';
import { GithubEngine } from '../../src/adapters/engines/github/github-engine.js';
import { GithubMetadataProvider } from '../../src/adapters/engines/github/github-metadata-provider.js';
import {
  SkillsMpEngine,
  skillPathFromGithubUrl,
} from '../../src/adapters/engines/skillsmp/skillsmp-engine.js';
import { SkillsShEngine } from '../../src/adapters/engines/skillssh/skillssh-engine.js';
import { engineConfigSchema, type EngineConfig } from '../../src/core/config/schema.js';
import type { SearchQuery } from '../../src/core/domain/search.js';
import { EngineError } from '../../src/core/errors.js';
import { engineFixture, FakeHttp, FixedSecrets, json, MemoryCache } from '../support/fake-http.js';

const query: SearchQuery = { text: 'seo audit', limit: 5, sort: 'stars' };
const signal = new AbortController().signal;

async function failure(p: Promise<unknown>): Promise<Error> {
  const e = await p.catch((err: unknown) => err);
  expect(e).toBeInstanceOf(EngineError);
  return e as Error;
}

describe('GithubEngine (contract, recorded search/repositories)', () => {
  it('maps repositories and sends qualifiers and the token', async () => {
    const http = new FakeHttp().route(
      /search\/repositories/,
      json(engineFixture('github-search-repos.json')),
    );
    const engine = new GithubEngine(http, new FixedSecrets({}, 'tok'), {
      id: 'github',
      qualifiers: 'claude skill',
    });
    const results = await engine.search(query, signal);
    const url = new URL(http.calls[0]?.url ?? '');
    expect(url.searchParams.get('q')).toBe('seo audit claude skill');
    expect(url.searchParams.get('sort')).toBe('stars');
    expect(url.searchParams.get('per_page')).toBe('5');
    expect(http.calls[0]?.headers['Authorization']).toBe('Bearer tok');
    expect(results[0]).toMatchObject({
      kind: 'repo',
      engineIds: ['github'],
      name: 'coreyhaines31/marketingskills',
      repo: { owner: 'coreyhaines31', name: 'marketingskills' },
      stars: 61438,
      author: 'coreyhaines31',
    });
    expect(results[0]?.updatedAt).toEqual(new Date('2026-11-18T18:11:26Z'));
    expect(engine.descriptor).toMatchObject({ type: 'github', stability: 'official' });
  });

  it('works without a token and explains rate limits and bad shapes', async () => {
    const anon = new FakeHttp().route(/./, json({ items: [] }));
    await new GithubEngine(anon, new FixedSecrets(), { id: 'github', qualifiers: '' }).search(
      query,
      signal,
    );
    expect(anon.calls[0]?.headers).not.toHaveProperty('Authorization');

    const limited = new FakeHttp().route(/./, json({ message: 'rate' }, 403));
    const e = await failure(
      new GithubEngine(limited, new FixedSecrets(), { id: 'github', qualifiers: '' }).search(
        query,
        signal,
      ),
    );
    expect(e.message).toMatch(/rate limit .*GITHUB_TOKEN/);

    const odd = new FakeHttp().route(/./, json({ items: [{ nope: 1 }] }));
    expect(
      (
        await failure(
          new GithubEngine(odd, new FixedSecrets(), { id: 'github', qualifiers: '' }).search(
            query,
            signal,
          ),
        )
      ).message,
    ).toMatch(/unexpected response/);
  });

  it('marks archived repositories', async () => {
    const repo = {
      full_name: 'a/b',
      name: 'b',
      owner: { login: 'a' },
      html_url: 'https://github.com/a/b',
      stargazers_count: 1,
      archived: true,
    };
    const http = new FakeHttp().route(/./, json({ items: [repo] }));
    const [r] = await new GithubEngine(http, new FixedSecrets(), {
      id: 'gh',
      qualifiers: '',
    }).search(query, signal);
    expect(r).toMatchObject({ archived: true });
    expect(r).not.toHaveProperty('description');
  });
});

describe('SkillsMpEngine (contract, recorded skills/search)', () => {
  it('maps skills with repo, path, language, stars and dates', async () => {
    const http = new FakeHttp().route(/skillsmp\.com/, json(engineFixture('skillsmp-search.json')));
    const results = await new SkillsMpEngine(http, new FixedSecrets(), {
      id: 'skillsmp',
      baseUrl: 'https://skillsmp.com/api/v1/',
    }).search(query, signal);
    expect(http.calls[0]?.url).toBe(
      'https://skillsmp.com/api/v1/skills/search?q=seo+audit&limit=5&sortBy=stars',
    );
    expect(http.calls[0]?.headers).toEqual({});
    expect(results[0]).toMatchObject({
      kind: 'skill',
      name: 'seo',
      author: 'affaan-m',
      language: 'ja',
      repo: { owner: 'affaan-m', name: 'ECC' },
      skillPath: 'docs/ja-JP/skills/seo',
      stars: 301144,
    });
    expect(results[0]?.updatedAt).toEqual(new Date(1778999500 * 1000));
  });

  it('sends the API key when configured and set', async () => {
    const http = new FakeHttp().route(/./, json({ data: { skills: [] } }));
    await new SkillsMpEngine(http, new FixedSecrets({ KEY: 'k' }), {
      id: 'skillsmp',
      baseUrl: 'https://x.test',
      apiKey: '${env:KEY}',
    }).search(query, signal);
    expect(http.calls[0]?.headers['Authorization']).toBe('Bearer k');
  });

  it('handles minimal items and errors', async () => {
    const http = new FakeHttp().route(
      /./,
      json({ data: { skills: [{ name: 'x', skillUrl: 'https://s/x' }] } }),
    );
    const [r] = await new SkillsMpEngine(http, new FixedSecrets(), {
      id: 'm',
      baseUrl: 'https://x.test',
    }).search(query, signal);
    expect(r).toEqual({ kind: 'skill', engineIds: ['m'], name: 'x', url: 'https://s/x' });
    const down = new FakeHttp().route(/./, json(null, 500));
    expect(
      (
        await failure(
          new SkillsMpEngine(down, new FixedSecrets(), {
            id: 'm',
            baseUrl: 'https://x.test',
          }).search(query, signal),
        )
      ).message,
    ).toBe('m: HTTP 500');
  });

  it.each([
    ['https://github.com/o/r/tree/main/skills/seo', 'skills/seo'],
    ['https://github.com/o/r/blob/main/skills/seo/SKILL.md', 'skills/seo'],
    ['https://github.com/o/r', undefined],
  ])('reads the skill path from %s', (url, path) => {
    expect(skillPathFromGithubUrl(url)).toBe(path);
  });
});

describe('SkillsShEngine (contract, recorded public /api/search)', () => {
  it('maps skills with installs and a skills.sh link', async () => {
    const http = new FakeHttp().route(/skills\.sh/, json(engineFixture('skillssh-search.json')));
    const engine = new SkillsShEngine(http, { id: 'skillssh', baseUrl: 'https://skills.sh/' });
    const results = await engine.search(query, signal);
    expect(http.calls[0]?.url).toBe('https://skills.sh/api/search?q=seo+audit&limit=5');
    expect(results[0]).toEqual({
      kind: 'skill',
      engineIds: ['skillssh'],
      name: 'seo-audit',
      url: 'https://skills.sh/coreyhaines31/marketingskills/seo-audit',
      repo: { owner: 'coreyhaines31', name: 'marketingskills' },
      author: 'coreyhaines31',
      installs: 259529,
    });
    expect(engine.descriptor.stability).toBe('unofficial');
  });

  it('copes with sources that are not GitHub repos, and with errors', async () => {
    const http = new FakeHttp().route(
      /./,
      json({ skills: [{ id: 'x', source: 'not a repo', name: 'x' }] }),
    );
    const [r] = await new SkillsShEngine(http, { id: 's', baseUrl: 'https://skills.sh' }).search(
      query,
      signal,
    );
    expect(r).not.toHaveProperty('repo');
    const auth = new FakeHttp().route(/./, json({}, 401));
    expect(
      (
        await failure(
          new SkillsShEngine(auth, { id: 's', baseUrl: 'https://skills.sh' }).search(query, signal),
        )
      ).message,
    ).toMatch(/needs authentication/);
  });
});

describe('GenericHttpEngine', () => {
  const config = engineConfigSchema.parse({
    id: 'mine',
    type: 'generic-http',
    name: 'My registry',
    request: {
      url: 'https://reg.test/find?q={query}&n={limit}',
      headers: { Authorization: 'Bearer ${env:REG_KEY}' },
    },
    response: {
      items: 'data.results',
      map: {
        name: 'title',
        url: 'link',
        description: 'meta.summary',
        repoUrl: 'repo',
        stars: 'stars',
        installs: 'downloads',
      },
    },
  }) as Extract<EngineConfig, { type: 'generic-http' }>;

  it('fills the URL template, resolves header secrets and maps fields', async () => {
    const http = new FakeHttp().route(
      /reg\.test/,
      json({
        data: {
          results: [
            {
              title: 'pdf',
              link: 'https://reg.test/s/pdf',
              meta: { summary: 'PDFs' },
              repo: 'https://github.com/o/r',
              stars: '12',
              downloads: 3,
            },
            { title: 'no-link' },
            { title: 'plain', link: 'https://github.com/a/b', stars: 'many' },
          ],
        },
      }),
    );
    const engine = new GenericHttpEngine(http, new FixedSecrets({ REG_KEY: 'secret' }), config);
    const results = await engine.search({ ...query, text: 'pdf tools' }, signal);
    expect(http.calls[0]?.url).toBe('https://reg.test/find?q=pdf%20tools&n=5');
    expect(http.calls[0]?.headers).toEqual({ Authorization: 'Bearer secret' });
    expect(results).toEqual([
      {
        kind: 'skill',
        engineIds: ['mine'],
        name: 'pdf',
        url: 'https://reg.test/s/pdf',
        repo: { owner: 'o', name: 'r' },
        description: 'PDFs',
        stars: 12,
        installs: 3,
      },
      {
        kind: 'skill',
        engineIds: ['mine'],
        name: 'plain',
        url: 'https://github.com/a/b',
        repo: { owner: 'a', name: 'b' },
      },
    ]);
    expect(engine.descriptor).toMatchObject({
      homepage: 'https://reg.test',
      requiresAuth: true,
      stability: 'unofficial',
    });
  });

  it('fails clearly on a missing secret or a missing result list', async () => {
    const http = new FakeHttp().route(/./, json({ data: {} }));
    expect(
      (await failure(new GenericHttpEngine(http, new FixedSecrets(), config).search(query, signal)))
        .message,
    ).toMatch(/header Authorization .* not set/);
    expect(
      (
        await failure(
          new GenericHttpEngine(http, new FixedSecrets({ REG_KEY: 'k' }), config).search(
            query,
            signal,
          ),
        )
      ).message,
    ).toMatch(/no list at "data.results"/);
  });

  it('reads dot paths', () => {
    expect(readPath({ a: [{ b: 1 }] }, 'a.0.b')).toBe(1);
    expect(readPath({ a: 1 }, 'a.b')).toBeUndefined();
    expect(readPath({ a: 1 }, '')).toEqual({ a: 1 });
  });
});

describe('DefaultEngineFactory', () => {
  const factory = new DefaultEngineFactory({ http: new FakeHttp(), secrets: new FixedSecrets() });

  it('builds every configured type', () => {
    const configs = [
      { id: 'github', type: 'github', token: '${env:T}' },
      { id: 'skillsmp', type: 'skillsmp', apiKey: '${env:K}' },
      { id: 'skillssh', type: 'skillssh' },
      {
        id: 'g',
        type: 'generic-http',
        name: 'G',
        request: { url: 'https://g.test/?q={query}' },
        response: { items: 'i', map: { name: 'n', url: 'u' } },
      },
    ].map((c) => engineConfigSchema.parse(c));
    expect(configs.map((c) => factory.create(c).descriptor.type)).toEqual([
      'github',
      'skillsmp',
      'skillssh',
      'generic-http',
    ]);
    expect(factory.types).toEqual(['github', 'skillsmp', 'skillssh', 'generic-http']);
  });

  it('rejects unknown types', () => {
    expect(() => factory.create({ id: 'x', type: 'ftp' } as unknown as EngineConfig)).toThrow(
      /Unknown engine type "ftp"/,
    );
  });
});

describe('GithubMetadataProvider', () => {
  const repoJson = (stars: number, extra: Record<string, unknown> = {}) =>
    json({
      full_name: 'o/r',
      name: 'r',
      owner: { login: 'o' },
      html_url: 'https://github.com/o/r',
      stargazers_count: stars,
      ...extra,
    });

  it('looks repos up once, caches them and skips missing ones', async () => {
    const http = new FakeHttp()
      .route(
        /repos\/o\/r$/,
        repoJson(42, {
          description: 'D',
          pushed_at: '2026-11-01T00:00:00Z',
          license: { spdx_id: 'MIT' },
          topics: ['t'],
        }),
      )
      .route(/repos\/gone\/x$/, json({}, 404))
      .route(/repos\/bad\/x$/, json({ weird: true }));
    const cache = new MemoryCache();
    const p = new GithubMetadataProvider(http, new FixedSecrets({}, 'tok'), cache);
    const refs = [
      { owner: 'o', name: 'r' },
      { owner: 'O', name: 'R' },
      { owner: 'gone', name: 'x' },
      { owner: 'bad', name: 'x' },
    ];
    const meta = await p.enrich(refs, signal);
    expect([...meta.keys()]).toEqual(['o/r']);
    expect(meta.get('o/r')).toEqual({
      stars: 42,
      description: 'D',
      pushedAt: new Date('2026-11-01T00:00:00Z'),
      license: 'MIT',
      topics: ['t'],
    });
    expect(http.calls).toHaveLength(3);
    expect(http.calls[0]?.headers['Authorization']).toBe('Bearer tok');

    await p.enrich([{ owner: 'o', name: 'r' }], signal);
    expect(http.calls).toHaveLength(3);
  });

  it('caps lookups and fails only when every lookup failed', async () => {
    const limited = new FakeHttp().route(/./, json({}, 403));
    const p = new GithubMetadataProvider(limited, new FixedSecrets(), new MemoryCache(), {
      maxRepos: 2,
      concurrency: 1,
    });
    await expect(
      p.enrich(
        [
          { owner: 'a', name: 'b' },
          { owner: 'c', name: 'd' },
          { owner: 'e', name: 'f' },
        ],
        signal,
      ),
    ).rejects.toThrow(/rate limit/);
    expect(limited.calls).toHaveLength(2);

    const mixed = new FakeHttp()
      .route(/repos\/ok\/r$/, repoJson(1, { archived: true }))
      .route(/repos\/bad\/r$/, new Error('net down'));
    const m = await new GithubMetadataProvider(mixed, new FixedSecrets(), new MemoryCache()).enrich(
      [
        { owner: 'ok', name: 'r' },
        { owner: 'bad', name: 'r' },
      ],
      signal,
    );
    expect(m.get('ok/r')).toEqual({ stars: 1, archived: true, topics: [] });
    expect(
      await new GithubMetadataProvider(mixed, new FixedSecrets(), new MemoryCache()).enrich(
        [],
        signal,
      ),
    ).toEqual(new Map());
  });
});

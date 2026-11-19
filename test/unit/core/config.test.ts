import { describe, expect, it } from 'vitest';
import { defaultConfig } from '../../../src/core/config/defaults.js';
import { parseConfig } from '../../../src/core/config/parse.js';
import { ConfigError } from '../../../src/core/errors.js';

describe('config', () => {
  it('has sensible defaults with three engines', () => {
    const config = defaultConfig();
    expect(config.engines.map((e) => [e.id, e.enabled])).toEqual([
      ['github', true],
      ['skillsmp', true],
      ['skillssh', true],
    ]);
    expect(config.search).toEqual({ defaultLimit: 20, defaultSort: 'stars', minStars: 0 });
    expect(config.review).toEqual({ windowDays: 30, disabledRules: [] });
  });

  it('round-trips through parse', () => {
    const config = defaultConfig();
    expect(parseConfig(JSON.parse(JSON.stringify(config)))).toEqual(config);
  });

  it('accepts a generic-http engine with env-referenced secrets', () => {
    const config = parseConfig({
      version: 1,
      engines: [
        {
          id: 'my-registry',
          type: 'generic-http',
          name: 'My registry',
          request: {
            url: 'https://example.com/search?q={query}',
            headers: { Authorization: 'Bearer x' },
          },
          response: { items: 'data.skills', map: { name: 'name', url: 'link' } },
        },
        { id: 'gh', type: 'github', token: '${env:GITHUB_TOKEN}' },
      ],
    });
    expect(config.engines).toHaveLength(2);
  });

  it.each([
    [{ version: 2, engines: [] }, 'version'],
    [{ version: 1, engines: [{ id: 'Bad Id', type: 'github' }] }, 'engines.0.id'],
    [{ version: 1, engines: [{ id: 'x', type: 'unknown' }] }, 'engines.0.type'],
    [
      { version: 1, engines: [{ id: 'gh', type: 'github', token: 'ghp_plaintext' }] },
      'never store secrets',
    ],
    [
      {
        version: 1,
        engines: [
          { id: 'a', type: 'github' },
          { id: 'a', type: 'skillsmp' },
        ],
      },
      'unique',
    ],
  ])('rejects invalid config (%#)', (raw, fragment) => {
    expect(() => parseConfig(raw)).toThrow(ConfigError);
    expect(() => parseConfig(raw)).toThrow(fragment);
  });
});

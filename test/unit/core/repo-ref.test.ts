import { describe, expect, it } from 'vitest';
import { parseRepoRef, repoKey } from '../../../src/core/util/repo-ref.js';

describe('parseRepoRef', () => {
  it.each([
    ['https://github.com/affaan-m/ECC/tree/main/docs/skills/seo', 'affaan-m', 'ECC'],
    ['https://github.com/obra/superpowers', 'obra', 'superpowers'],
    ['http://www.github.com/a/b.git', 'a', 'b'],
    ['github.com/a/b?tab=readme', 'a', 'b'],
    ['coreyhaines31/marketingskills', 'coreyhaines31', 'marketingskills'],
    ['  owner/repo.name  ', 'owner', 'repo.name'],
  ])('parses %s', (input, owner, name) => {
    expect(parseRepoRef(input)).toEqual({ owner, name });
  });

  it.each(['', 'https://gitlab.com/a/b', 'just-a-name', 'a/b/c'])('rejects %s', (input) => {
    expect(parseRepoRef(input)).toBeUndefined();
  });

  it('builds case-insensitive keys', () => {
    expect(repoKey({ owner: 'Obra', name: 'SuperPowers' })).toBe('obra/superpowers');
  });
});

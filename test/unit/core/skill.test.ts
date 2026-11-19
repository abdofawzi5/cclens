import { describe, expect, it } from 'vitest';
import { parseSkillId, qualifySkillId } from '../../../src/core/domain/skill.js';

describe('skill ids', () => {
  it('qualifies plugin skills and leaves standalone skills bare', () => {
    expect(qualifySkillId('seo-audit', 'marketing')).toBe('marketing:seo-audit');
    expect(qualifySkillId('write-article')).toBe('write-article');
  });

  it.each([
    ['marketing:seo-audit', { plugin: 'marketing', name: 'seo-audit' }],
    ['write-article', { name: 'write-article' }],
    [':odd', { name: ':odd' }],
    ['odd:', { name: 'odd:' }],
  ])('parses %s', (id, expected) => {
    expect(parseSkillId(id)).toEqual(expected);
  });

  it('round-trips', () => {
    const { plugin, name } = parseSkillId('a:b');
    expect(qualifySkillId(name, plugin)).toBe('a:b');
  });
});

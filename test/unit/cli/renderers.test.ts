import { stripVTControlCharacters as strip } from 'node:util';
import { describe, expect, it } from 'vitest';
import { JsonRenderer } from '../../../src/interfaces/render/json-renderer.js';
import { KeyValueRenderer } from '../../../src/interfaces/render/key-value-renderer.js';

describe('KeyValueRenderer', () => {
  const r = new KeyValueRenderer();

  it('renders primitives as-is', () => {
    expect(r.render('x')).toBe('x');
    expect(r.render(null)).toBe('null');
  });

  it('aligns keys and formats every value type', () => {
    const out = strip(
      r.render({
        a: 'text',
        long: 3,
        bool: true,
        big: 10n,
        date: new Date('2026-01-02T03:04:05Z'),
        none: undefined,
        obj: { x: 1 },
      }),
    );
    expect(out.split('\n')).toEqual([
      'a     text',
      'long  3',
      'bool  true',
      'big   10',
      'date  2026-01-02T03:04:05.000Z',
      'none  ',
      'obj   {"x":1}',
    ]);
  });
});

describe('JsonRenderer', () => {
  it('serialises Maps and Dates', () => {
    const out = new JsonRenderer().render({ m: new Map([['k', 1]]), d: new Date(0) });
    expect(JSON.parse(out)).toEqual({ m: { k: 1 }, d: '1970-01-01T00:00:00.000Z' });
  });
});

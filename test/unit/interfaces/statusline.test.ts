import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  FileSpendRollupStore,
  parseRollup,
  readRollupFile,
} from '../../../src/adapters/storage/spend-rollup-file.js';
import {
  budgetFromConfig,
  statusline,
  statuslineText,
} from '../../../src/interfaces/statusline/statusline.js';
import { rollup } from '../../support/budget.js';

const now = new Date('2026-11-19T12:00:00Z');

describe('statuslineText', () => {
  it('shows spend, limits and skill uses', () => {
    expect(statuslineText({ rollup: rollup(), now })).toBe(
      'cclens · today $71 · month $300 · 2 skill uses today',
    );
    expect(
      statuslineText({ rollup: rollup(), now, budget: { daily: 50, monthly: 800, warnAt: 100 } }),
    ).toBe('cclens · today $71 ⚠ / $50 · month $300 / $800 · 2 skill uses today');
  });

  it('counts an old day as zero and says when there is no data yet', () => {
    expect(statuslineText({ rollup: rollup({ day: '2026-11-18', skillUsesToday: 4 }), now })).toBe(
      'cclens · today $0.00 · month $300',
    );
    expect(statuslineText({ now })).toBe('cclens · estimating spend…');
  });

  it('reads the budget from config JSON by hand', () => {
    expect(budgetFromConfig({ budget: { daily: 50, warnAt: 80 } })).toEqual({
      daily: 50,
      monthly: undefined,
      warnAt: 80,
    });
    expect(budgetFromConfig({ budget: { warnAt: 100 } })).toBeUndefined();
    expect(budgetFromConfig({ budget: { daily: 'x' } })).toBeUndefined();
    expect(budgetFromConfig(null)).toBeUndefined();
  });
});

describe('spend rollup file and statusline', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'cclens-statusline-'));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('round-trips the rollup and rejects bad files', async () => {
    const path = join(dir, 'cache', 'spend.json');
    const store = new FileSpendRollupStore(path);
    expect(await store.read()).toBeUndefined();
    await store.write(rollup({ warned: { daily: '2026-11-19' } }));
    expect(await store.read()).toEqual(rollup({ warned: { daily: '2026-11-19' } }));
    await writeFile(path, '{bad');
    expect(await readRollupFile(path)).toBeUndefined();
    expect(parseRollup({ day: 'x' })).toBeUndefined();
    expect(parseRollup({ ...rollup(), updatedAt: 'nope' })).toBeUndefined();
  });

  it('prints from the files and refreshes only when stale', async () => {
    const env = { CCLENS_HOME: dir };
    let refreshes = 0;
    const refresh = (): void => {
      refreshes++;
    };
    expect(await statusline({ env, now, refresh })).toBe('cclens · estimating spend…');
    expect(refreshes).toBe(1);

    await mkdir(join(dir, 'cache'));
    await new FileSpendRollupStore(join(dir, 'cache', 'spend.json')).write(rollup());
    await writeFile(join(dir, 'config.json'), JSON.stringify({ budget: { daily: 100 } }));
    expect(await statusline({ env, now, refresh })).toBe(
      'cclens · today $71 / $100 · month $300 · 2 skill uses today',
    );
    expect(refreshes).toBe(1);
    await statusline({ env, now: new Date('2026-11-19T13:00:00Z'), refresh });
    expect(refreshes).toBe(2);
  });
});

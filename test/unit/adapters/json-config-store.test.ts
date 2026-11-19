import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { JsonConfigStore } from '../../../src/adapters/storage/json-config-store.js';
import { defaultConfig } from '../../../src/core/config/defaults.js';
import { ConfigError } from '../../../src/core/errors.js';

describe('JsonConfigStore', () => {
  let dir: string;
  let store: JsonConfigStore;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'cclens-'));
    store = new JsonConfigStore(join(dir, 'nested', 'config.json'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('returns defaults when the file is missing', async () => {
    expect(await store.exists()).toBe(false);
    expect(await store.load()).toEqual(defaultConfig());
  });

  it('saves atomically and loads back', async () => {
    const config = defaultConfig();
    await store.save({ ...config, review: { ...config.review, windowDays: 7 } });
    expect(await store.exists()).toBe(true);
    expect((await store.load()).review.windowDays).toBe(7);
    const text = await readFile(store.path, 'utf8');
    expect(text.endsWith('\n')).toBe(true);
  });

  it('reports malformed JSON and invalid content as ConfigError', async () => {
    await store.save(defaultConfig());
    await writeFile(store.path, '{ nope');
    await expect(store.load()).rejects.toThrow(/not valid JSON/);
    await writeFile(store.path, JSON.stringify({ version: 1, engines: 'x' }));
    await expect(store.load()).rejects.toBeInstanceOf(ConfigError);
  });

  it('refuses to save an invalid config', async () => {
    const bad = { ...defaultConfig(), version: 9 } as unknown as ReturnType<typeof defaultConfig>;
    await expect(store.save(bad)).rejects.toBeInstanceOf(ConfigError);
    expect(await store.exists()).toBe(false);
  });
});

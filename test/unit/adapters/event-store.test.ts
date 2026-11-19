import { appendFile, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { JsonlEventStore } from '../../../src/adapters/storage/jsonl-event-store.js';
import {
  decodeUsageEvent,
  encodeUsageEvent,
} from '../../../src/adapters/storage/usage-event-codec.js';
import { event, MemoryLogger, collect } from '../../support/fakes.js';

describe('usage event codec', () => {
  it('round-trips with and without a session id', () => {
    for (const e of [
      event('a', '2026-11-19T10:00:00Z'),
      event('b', '2026-11-19T10:00:00Z', { sessionId: 's' }),
    ]) {
      expect(decodeUsageEvent(encodeUsageEvent(e))).toEqual(e);
    }
  });

  it.each([
    '',
    '   ',
    '{bad',
    '{"v":2}',
    '{"v":1,"ts":"nope","source":"auto","skill":"s","project":"p"}',
  ])('rejects %j', (line) => {
    expect(decodeUsageEvent(line)).toBeUndefined();
  });
});

describe('JsonlEventStore', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'cclens-events-'));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('creates, appends, filters and skips bad lines', async () => {
    const logger = new MemoryLogger();
    const file = join(dir, 'a', 'events.jsonl');
    const store = new JsonlEventStore(file, logger);
    expect(await store.exists()).toBe(false);
    expect(await collect(store.query())).toEqual([]);
    await store.ensure();
    await store.ensure();
    expect(await store.exists()).toBe(true);
    await store.append(event('x', '2026-11-18T00:00:00Z'));
    await store.appendMany([]);
    await appendFile(file, 'garbage\n');
    await store.appendMany([
      event('y', '2026-11-19T00:00:00Z'),
      event('x', '2026-11-20T00:00:00Z'),
    ]);

    const all = await collect(store.query());
    expect(all.map((e) => e.skill)).toEqual(['x', 'y', 'x']);
    const filtered = await collect(
      store.query({ skill: 'x', since: new Date('2026-11-19T00:00:00Z') }),
    );
    expect(filtered).toHaveLength(1);
    expect(logger.entries.filter((e) => e.level === 'warn')).toHaveLength(2);
    expect((await readFile(file, 'utf8')).split('\n').filter(Boolean)).toHaveLength(4);
  });
});

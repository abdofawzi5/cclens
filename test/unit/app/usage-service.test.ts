import { describe, expect, it } from 'vitest';
import { UsageService } from '../../../src/app/usage-service.js';
import { ArraySource, event, FixedClock, MemoryEventStore } from '../../support/fakes.js';

describe('UsageService', () => {
  it('records live events with the clock time', async () => {
    const store = new MemoryEventStore();
    const service = new UsageService(store, new FixedClock());
    const e = await service.record({ skill: 's', source: 'auto', project: 'p', sessionId: 'x' });
    expect(e).toEqual({
      v: 1,
      ts: new Date('2026-11-19T12:00:00Z'),
      source: 'auto',
      skill: 's',
      project: 'p',
      sessionId: 'x',
    });
    await service.record({ skill: 't', source: 'typed', project: 'p' });
    expect(store.events[1]).not.toHaveProperty('sessionId');
  });

  it('imports history once, in time order, and never past the first live event', async () => {
    const store = new MemoryEventStore();
    store.events.push(event('live', '2026-11-18T00:00:00Z', { source: 'auto' }));
    const service = new UsageService(store, new FixedClock());
    const source = new ArraySource('t', [
      event('b', '2026-11-17T00:00:00Z'),
      event('a', '2026-11-16T00:00:00Z'),
      event('a', '2026-11-16T00:00:00Z'),
      event('after-live', '2026-11-18T00:00:00Z'),
    ]);

    expect(await service.import(source)).toEqual({
      sourceId: 't',
      read: 4,
      imported: 2,
      duplicates: 2,
    });
    expect(store.events.map((e) => e.skill)).toEqual(['live', 'a', 'b']);
    expect((await service.import(source)).imported).toBe(0);
  });

  it('counts by skill, most used first, ties alphabetical', async () => {
    const store = new MemoryEventStore();
    store.events.push(
      event('b', '2026-11-16T00:00:00Z'),
      event('a', '2026-11-16T00:00:00Z'),
      event('c', '2026-11-16T00:00:00Z'),
      event('c', '2026-11-17T00:00:00Z'),
    );
    const service = new UsageService(store, new FixedClock());
    expect([...(await service.countBySkill())]).toEqual([
      ['c', 2],
      ['a', 1],
      ['b', 1],
    ]);
    expect(await service.total({ skill: 'c' })).toBe(2);
  });
});

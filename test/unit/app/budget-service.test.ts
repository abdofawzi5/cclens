import { describe, expect, it } from 'vitest';
import { BudgetService, REFRESH_ARGS } from '../../../src/app/budget-service.js';
import { ConfigService } from '../../../src/app/config-service.js';
import { UsageService } from '../../../src/app/usage-service.js';
import { ValidationError } from '../../../src/core/errors.js';
import { MemorySpendStore, RecordingRunner, rollup } from '../../support/budget.js';
import { event, FixedClock, MemoryEventStore } from '../../support/fakes.js';
import { FakeTokens } from '../../support/fake-tokens.js';
import { InMemoryConfigStore } from '../../support/in-memory-config-store.js';

function setup(store = new MemorySpendStore()) {
  const events = new MemoryEventStore();
  const clock = new FixedClock();
  const background = new RecordingRunner();
  const configStore = new InMemoryConfigStore();
  const service = new BudgetService({
    config: new ConfigService(configStore),
    store,
    tokens: new FakeTokens(),
    usage: new UsageService(events, clock),
    clock,
    background,
  });
  return { service, store, events, clock, background, configStore };
}

describe('BudgetService', () => {
  it('sets, merges and clears limits, keeping warnAt', async () => {
    const { service, configStore } = setup();
    await service.set({ daily: 50 });
    expect(await service.set({ monthly: 800, warnAt: 80 })).toEqual({
      daily: 50,
      monthly: 800,
      warnAt: 80,
    });
    await service.clear();
    expect(configStore.saved?.budget).toEqual({ warnAt: 80 });
    await expect(service.set({})).rejects.toBeInstanceOf(ValidationError);
  });

  it('refreshes the rollup from ccusage and the usage log, keeping warned days', async () => {
    const { service, store, events } = setup(
      new MemorySpendStore(rollup({ warned: { daily: '2026-11-19' } })),
    );
    events.events.push(event('a', '2026-11-19T09:00:00Z'), event('b', '2026-11-10T09:00:00Z'));
    const r = await service.refresh();
    // FakeTokens: 2026-11-18 costs $1, 2026-11-19 costs $2.
    expect(r).toMatchObject({ day: '2026-11-19', month: '2026-11', todayUsd: 2, monthUsd: 3 });
    expect(r.skillUsesToday).toBe(1);
    expect(r.warned).toEqual({ daily: '2026-11-19' });
    expect(store.value).toEqual(r);
  });

  it('does nothing in the hook when no budget is set', async () => {
    const { service, store, background } = setup();
    expect(await service.hookWarning()).toBeUndefined();
    expect(background.started).toEqual([]);
    expect(store.writes).toBe(0);
  });

  it('warns once per limit per day from the rollup', async () => {
    const { service, store, background } = setup(new MemorySpendStore(rollup()));
    await service.set({ daily: 50 });
    expect(await service.hookWarning()).toBe(
      "cclens: today's estimated cost is $71 (daily budget $50)",
    );
    expect(store.value?.warned).toEqual({ daily: '2026-11-19' });
    expect(await service.hookWarning()).toBeUndefined();
    expect(background.started).toEqual([]);
  });

  it('starts a background refresh when the rollup is missing or stale', async () => {
    const stale = rollup({ updatedAt: new Date('2026-11-19T11:00:00Z') });
    const { service, background } = setup(new MemorySpendStore(stale));
    await service.set({ daily: 50 });
    expect(await service.hookWarning()).toContain('$71');
    expect(background.started).toEqual([REFRESH_ARGS]);

    const empty = setup();
    await empty.service.set({ daily: 50 });
    expect(await empty.service.hookWarning()).toBeUndefined();
    expect(empty.background.started).toEqual([REFRESH_ARGS]);
  });

  it('shows statuses after a refresh', async () => {
    const { service } = setup();
    await service.set({ daily: 1, monthly: 100 });
    const view = await service.show();
    expect(view.statuses.map((s) => [s.limit, s.spentUsd, s.over])).toEqual([
      ['daily', 2, true],
      ['monthly', 3, false],
    ]);
  });
});

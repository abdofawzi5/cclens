import { describe, expect, it } from 'vitest';
import { InventoryService } from '../../../src/app/inventory/inventory-service.js';
import { TokenService } from '../../../src/app/token-service.js';
import { UsageService } from '../../../src/app/usage-service.js';
import type { Skill } from '../../../src/core/domain/skill.js';
import { event, FixedClock, MemoryEventStore } from '../../support/fakes.js';
import { FakeTokens } from '../../support/fake-tokens.js';

const SKILLS: Skill[] = [
  { id: 'marketing:seo-audit', name: 'seo-audit', scope: 'plugin', plugin: 'marketing' },
  { id: 'marketing:email', name: 'email', scope: 'plugin', plugin: 'marketing' },
  { id: 'write-article', name: 'write-article', scope: 'personal' },
];

function inventory(): InventoryService {
  const store = new MemoryEventStore();
  store.events.push(
    event('marketing:seo-audit', '2026-11-10T00:00:00Z'),
    event('marketing:seo-audit', '2026-11-18T00:00:00Z'),
    event('write-article', '2026-11-18T00:00:00Z'),
    event('old:removed', '2026-11-01T00:00:00Z'),
  );
  return new InventoryService(
    { id: 'fake', list: () => Promise.resolve(SKILLS) },
    new UsageService(store, new FixedClock()),
  );
}

describe('InventoryService', () => {
  it('joins installed skills with use counts and summarises', async () => {
    const r = await inventory().report();
    expect(r.total).toBe(3);
    expect(r.byScope).toEqual({ personal: 1, project: 0, plugin: 2, builtin: 0 });
    expect(r.skills.map((s) => [s.id, s.uses])).toEqual([
      ['marketing:seo-audit', 2],
      ['write-article', 1],
      ['marketing:email', 0],
    ]);
    expect(r.byPlugin).toEqual([
      { plugin: 'marketing', skills: 2, uses: 2 },
      { plugin: '(standalone)', skills: 1, uses: 1 },
    ]);
    expect([...r.unknownUses]).toEqual([['old:removed', 1]]);
  });

  it('filters by scope, plugin, unused and usage window', async () => {
    const svc = inventory();
    expect((await svc.report({ scope: 'personal' })).skills.map((s) => s.id)).toEqual([
      'write-article',
    ]);
    expect((await svc.report({ plugin: '(standalone)' })).skills).toHaveLength(1);
    expect((await svc.report({ unusedOnly: true })).skills.map((s) => s.id)).toEqual([
      'marketing:email',
    ]);
    const recent = await svc.report({ usage: { since: new Date('2026-11-15T00:00:00Z') } });
    expect(recent.skills.find((s) => s.id === 'marketing:seo-audit')?.uses).toBe(1);
  });
});

describe('TokenService', () => {
  const svc = new TokenService(new FakeTokens());

  it('returns period views with totals, newest n when limited', async () => {
    const r = await svc.report('daily', {}, 1);
    expect(r.rows).toHaveLength(1);
    expect(r.totals).toEqual({
      counts: { input: 2, output: 2, cacheCreation: 2, cacheRead: 2 },
      total: 8,
      costUsd: 2,
    });
    expect((await svc.report('weekly')).rows).toHaveLength(2);
    expect((await svc.report('monthly')).view).toBe('monthly');
  });

  it('sorts sessions by cost and keeps the top n', async () => {
    const r = await svc.report('session', {}, 1);
    expect(r.view === 'session' && r.rows[0]?.sessionId).toBe('expensive');
  });

  it('returns project and block views', async () => {
    expect((await svc.report('project')).rows).toHaveLength(1);
    expect((await svc.report('blocks')).totals.costUsd).toBe(3);
  });
});

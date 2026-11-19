import type { SpendRollup } from '../../src/core/domain/budget.js';
import type { BackgroundRunner, SpendRollupStore } from '../../src/core/ports/infrastructure.js';

export const rollup = (p: Partial<SpendRollup> = {}): SpendRollup => ({
  updatedAt: new Date('2026-11-19T11:58:00Z'),
  day: '2026-11-19',
  month: '2026-11',
  todayUsd: 71,
  monthUsd: 300,
  skillUsesToday: 2,
  warned: {},
  ...p,
});

export class MemorySpendStore implements SpendRollupStore {
  writes = 0;
  constructor(public value?: SpendRollup) {}
  read(): Promise<SpendRollup | undefined> {
    return Promise.resolve(this.value);
  }
  write(r: SpendRollup): Promise<void> {
    this.value = r;
    this.writes++;
    return Promise.resolve();
  }
}

export class RecordingRunner implements BackgroundRunner {
  readonly started: (readonly string[])[] = [];
  start(args: readonly string[]): void {
    this.started.push(args);
  }
}

import { readFile } from 'node:fs/promises';
import type { BudgetLimit, SpendRollup } from '../../core/domain/budget.js';
import type { SpendRollupStore } from '../../core/ports/infrastructure.js';
import { writeFileAtomic } from './atomic-write.js';

/*
 * Kept free of zod and other heavy imports: the status line loads this module on
 * every redraw and must answer in well under 100 ms.
 */

const num = (v: unknown): number | undefined =>
  typeof v === 'number' && Number.isFinite(v) ? v : undefined;
const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);

/** Validates the file's JSON by hand; anything unexpected reads as no rollup. */
export function parseRollup(raw: unknown): SpendRollup | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const o = raw as Record<string, unknown>;
  const updatedAt = str(o['updatedAt']);
  const day = str(o['day']);
  const month = str(o['month']);
  const todayUsd = num(o['todayUsd']);
  const monthUsd = num(o['monthUsd']);
  if (!updatedAt || !day || !month || todayUsd === undefined || monthUsd === undefined) {
    return undefined;
  }
  const at = new Date(updatedAt);
  if (Number.isNaN(at.getTime())) return undefined;
  const warned: Partial<Record<BudgetLimit, string>> = {};
  const w = o['warned'];
  if (w && typeof w === 'object') {
    for (const limit of ['daily', 'monthly'] as const) {
      const v = str((w as Record<string, unknown>)[limit]);
      if (v) warned[limit] = v;
    }
  }
  return {
    updatedAt: at,
    day,
    month,
    todayUsd,
    monthUsd,
    skillUsesToday: num(o['skillUsesToday']) ?? 0,
    warned,
  };
}

export async function readRollupFile(path: string): Promise<SpendRollup | undefined> {
  try {
    return parseRollup(JSON.parse(await readFile(path, 'utf8')));
  } catch {
    return undefined;
  }
}

/** `~/.cclens/cache/spend.json`, written atomically. */
export class FileSpendRollupStore implements SpendRollupStore {
  constructor(private readonly path: string) {}

  read(): Promise<SpendRollup | undefined> {
    return readRollupFile(this.path);
  }

  write(rollup: SpendRollup): Promise<void> {
    return writeFileAtomic(this.path, `${JSON.stringify(rollup, null, 2)}\n`);
  }
}

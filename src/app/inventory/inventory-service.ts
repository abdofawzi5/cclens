import type { Skill, SkillScope } from '../../core/domain/skill.js';
import type { UsageFilter } from '../../core/domain/usage-event.js';
import type { SkillSource } from '../../core/ports/skills.js';
import type { UsageService } from '../usage-service.js';

export interface SkillRow extends Skill {
  readonly uses: number;
}

export interface InventoryReport {
  readonly total: number;
  readonly byScope: Readonly<Record<SkillScope, number>>;
  /** Skills per plugin (`(standalone)` for personal/project skills), most first. */
  readonly byPlugin: readonly {
    readonly plugin: string;
    readonly skills: number;
    readonly uses: number;
  }[];
  readonly skills: readonly SkillRow[];
  /** Uses recorded for names that match no installed skill (removed or custom commands). */
  readonly unknownUses: ReadonlyMap<string, number>;
}

export interface InventoryQuery {
  readonly scope?: SkillScope;
  readonly plugin?: string;
  /** Only skills with zero uses in the usage window. */
  readonly unusedOnly?: boolean;
  readonly usage?: UsageFilter;
}

const STANDALONE = '(standalone)';

/** Installed skills joined with how often each was used. */
export class InventoryService {
  constructor(
    private readonly source: SkillSource,
    private readonly usage: UsageService,
  ) {}

  async report(query: InventoryQuery = {}): Promise<InventoryReport> {
    const [installed, counts] = await Promise.all([
      this.source.list(),
      this.usage.countBySkill(query.usage),
    ]);

    const rows: SkillRow[] = installed.map((s) => ({ ...s, uses: counts.get(s.id) ?? 0 }));
    const known = new Set(installed.map((s) => s.id));
    const unknownUses = new Map([...counts].filter(([id]) => !known.has(id)));

    const byScope: Record<SkillScope, number> = { personal: 0, project: 0, plugin: 0, builtin: 0 };
    const plugins = new Map<string, { skills: number; uses: number }>();
    for (const r of rows) {
      byScope[r.scope] += 1;
      const key = r.plugin ?? STANDALONE;
      const p = plugins.get(key) ?? { skills: 0, uses: 0 };
      plugins.set(key, { skills: p.skills + 1, uses: p.uses + r.uses });
    }

    const filtered = rows
      .filter((r) => !query.scope || r.scope === query.scope)
      .filter((r) => !query.plugin || (r.plugin ?? STANDALONE) === query.plugin)
      .filter((r) => !query.unusedOnly || r.uses === 0)
      .sort((a, b) => b.uses - a.uses || a.id.localeCompare(b.id));

    return {
      total: rows.length,
      byScope,
      byPlugin: [...plugins]
        .map(([plugin, v]) => ({ plugin, ...v }))
        .sort((a, b) => b.skills - a.skills || a.plugin.localeCompare(b.plugin)),
      skills: filtered,
      unknownUses,
    };
  }
}

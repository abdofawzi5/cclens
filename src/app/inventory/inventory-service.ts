import {
  type EnabledPlugin,
  type FixHint,
  fixHints,
  type UnusedGroup,
} from '../../core/domain/fix-hints.js';
import type { Skill, SkillScope } from '../../core/domain/skill.js';
import { latestSkillListing } from '../../core/domain/overhead.js';
import type { ContextOverheadSource } from '../../core/ports/overhead.js';
import type { ClaudeSettingsManager } from '../../core/ports/claude-settings.js';
import { skillListingTokens } from '../../core/rules/unused-skills.js';
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

/** What `--fix` needs to tell Claude Code plugins from desktop-app ones. */
export interface FixContext {
  readonly settings: Pick<ClaudeSettingsManager, 'enabledPlugins'>;
  readonly claudeHome: string;
  /** Measured skill listing; estimates are used without it. */
  readonly overhead?: ContextOverheadSource;
}

/** Installed skills joined with how often each was used. */
export class InventoryService {
  constructor(
    private readonly source: SkillSource,
    private readonly usage: UsageService,
    private readonly fix?: FixContext,
  ) {}

  /**
   * How to stop listing what went unused in the window: whole plugins with no use,
   * and standalone skills with no use. Commands are printed, never run.
   */
  async fixHints(usage?: UsageFilter): Promise<readonly FixHint[]> {
    const [installed, counts, listing] = await Promise.all([
      this.source.list(),
      this.usage.countBySkill(usage),
      this.fix?.overhead
        ?.read(new Date(Date.now() - 14 * 86_400_000))
        .then(latestSkillListing)
        .catch(() => undefined),
    ]);
    const plugins = new Map<string, { skills: Skill[]; uses: number }>();
    const groups: UnusedGroup[] = [];
    for (const s of installed) {
      const uses = counts.get(s.id) ?? 0;
      if (!s.plugin) {
        if (uses === 0 && s.scope !== 'builtin') {
          groups.push({
            skillId: s.id,
            skills: 1,
            tokens: skillListingTokens(s, listing),
            ...(s.path ? { path: s.path } : {}),
          });
        }
        continue;
      }
      const p = plugins.get(s.plugin) ?? { skills: [], uses: 0 };
      p.skills.push(s);
      p.uses += uses;
      plugins.set(s.plugin, p);
    }
    for (const [plugin, p] of plugins) {
      if (p.uses > 0) continue;
      const path = p.skills.find((s) => s.path)?.path;
      groups.push({
        plugin,
        skills: p.skills.length,
        tokens: p.skills.reduce((n, s) => n + skillListingTokens(s, listing), 0),
        ...(path ? { path } : {}),
      });
    }
    const enabled: EnabledPlugin[] = [];
    if (this.fix) {
      for (const scope of ['user', 'project'] as const) {
        const keys = await this.fix.settings.enabledPlugins(scope).catch(() => []);
        enabled.push(...keys.map((key) => ({ key, scope })));
      }
    }
    return fixHints(groups, enabled, this.fix?.claudeHome ?? '\0');
  }

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

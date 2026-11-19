/*
 * `--fix` hints: how to stop listing unused skills. cclens only prints these;
 * it never runs them (PLAN Phase 11).
 */

export interface UnusedGroup {
  /** Plugin name, or undefined for a standalone personal or project skill. */
  readonly plugin?: string;
  /** Skill id when standalone. */
  readonly skillId?: string;
  readonly skills: number;
  /** Listing tokens the group adds to every request. */
  readonly tokens: number;
  /** A skill folder or SKILL.md inside the group, when known. */
  readonly path?: string;
}

/** An `enabledPlugins` key (`name@marketplace`) and the settings file it is in. */
export interface EnabledPlugin {
  readonly key: string;
  readonly scope: 'user' | 'project';
}

export type FixHint =
  | {
      readonly kind: 'command';
      readonly group: UnusedGroup;
      readonly command: string;
      readonly note?: string;
    }
  | { readonly kind: 'manual'; readonly group: UnusedGroup; readonly note: string };

const pluginName = (key: string): string => key.split('@')[0] ?? key;

/**
 * The `name@marketplace` id Claude Code gives a plugin, from where it is installed:
 * `<claudeHome>/plugins/cache/<marketplace>/<name>/…` or `<claudeHome>/plugins/synced/…`
 * (plugins synced from a claude.ai account, id `name@synced`).
 */
export function pluginKeyFromPath(
  path: string,
  plugin: string,
  claudeHome: string,
): string | undefined {
  if (!path.startsWith(claudeHome)) return undefined;
  const rel = path.slice(claudeHome.length).replaceAll('\\', '/');
  const cached = /\/plugins\/cache\/([^/]+)\/([^/]+)\//.exec(rel);
  if (cached?.[1] && cached[2]) return `${cached[2]}@${cached[1]}`;
  if (rel.includes('/plugins/synced/')) return `${plugin}@synced`;
  return undefined;
}

/**
 * Claude Code plugins get a `claude plugin disable` command. Plugins installed by the
 * Claude desktop app cannot be turned off that way, and standalone skills are folders,
 * so those get a note instead. Biggest saving first.
 */
export function fixHints(
  groups: readonly UnusedGroup[],
  enabled: readonly EnabledPlugin[],
  claudeHome: string,
): readonly FixHint[] {
  return [...groups]
    .sort((a, b) => b.tokens - a.tokens)
    .map((group): FixHint => {
      if (!group.plugin) {
        const dir = group.path?.replace(/[\\/]SKILL\.md$/i, '') ?? group.skillId ?? '';
        return {
          kind: 'manual',
          group,
          note: `standalone skill: move ${dir} out of your skills folder to stop listing it`,
        };
      }
      const key = enabled.find((e) => pluginName(e.key) === group.plugin);
      if (key) {
        const scope = key.scope === 'project' ? ' --scope project' : '';
        return { kind: 'command', group, command: `claude plugin disable ${key.key}${scope}` };
      }
      const fromPath = group.path && pluginKeyFromPath(group.path, group.plugin, claudeHome);
      if (fromPath) {
        return {
          kind: 'command',
          group,
          command: `claude plugin disable ${fromPath}`,
          ...(fromPath.endsWith('@synced') ? { note: 'synced from your claude.ai account' } : {}),
        };
      }
      if (group.path?.startsWith(claudeHome)) {
        return { kind: 'command', group, command: `claude plugin disable ${group.plugin}` };
      }
      return {
        kind: 'manual',
        group,
        note: 'installed by the Claude desktop app: turn it off in the app’s plugin settings',
      };
    });
}

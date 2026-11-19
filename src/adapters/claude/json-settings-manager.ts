import { copyFile, mkdir, readFile, rm } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { z } from 'zod';
import { ConfigError } from '../../core/errors.js';
import type {
  ClaudeSettingsManager,
  HookSpec,
  SettingsBackup,
  SettingsScope,
} from '../../core/ports/claude-settings.js';
import type { Clock } from '../../core/ports/infrastructure.js';
import { writeFileAtomic } from '../storage/atomic-write.js';

const hookEntry = z.looseObject({ type: z.string(), command: z.string().optional() });
const hookGroup = z.looseObject({ matcher: z.string().optional(), hooks: z.array(hookEntry) });
const settingsSchema = z.looseObject({
  hooks: z.record(z.string(), z.array(hookGroup)).optional(),
});
// Parsed on its own so an odd `enabledPlugins` never blocks or alters hook edits.
const enabledPluginsSchema = z.record(z.string(), z.unknown());

type Settings = z.infer<typeof settingsSchema>;
type HookGroup = z.infer<typeof hookGroup>;

const EVENTS = ['PostToolUse', 'UserPromptSubmit', 'SessionStart', 'Stop'] as const;

/**
 * Edits Claude Code's settings.json. Preserves every key it does not own,
 * writes atomically, and only ever adds or removes individual hook entries.
 */
export class JsonSettingsManager implements ClaudeSettingsManager {
  constructor(
    private readonly claudeHome: string,
    private readonly projectDir: string,
    private readonly backupsDir: string,
    private readonly clock: Clock,
  ) {}

  settingsPath(scope: SettingsScope): string {
    return scope === 'user'
      ? join(this.claudeHome, 'settings.json')
      : join(this.projectDir, '.claude', 'settings.json');
  }

  async backup(scope: SettingsScope): Promise<SettingsBackup> {
    const settingsPath = this.settingsPath(scope);
    const stamp = this.clock.now().toISOString().replace(/[:.]/g, '-');
    const backupPath = join(
      this.backupsDir,
      `${scope}-${basename(settingsPath, '.json')}.${stamp}.json`,
    );
    await mkdir(this.backupsDir, { recursive: true });
    try {
      await copyFile(settingsPath, backupPath);
      return { scope, settingsPath, backupPath, existed: true };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      return { scope, settingsPath, backupPath, existed: false };
    }
  }

  async restore(backup: SettingsBackup): Promise<void> {
    if (backup.existed) {
      await writeFileAtomic(backup.settingsPath, await readFile(backup.backupPath, 'utf8'));
    } else {
      await rm(backup.settingsPath, { force: true });
    }
  }

  async addHooks(scope: SettingsScope, specs: readonly HookSpec[]): Promise<readonly HookSpec[]> {
    const settings = await this.read(scope);
    const hooks = { ...(settings.hooks ?? {}) };
    const added: HookSpec[] = [];
    for (const spec of specs) {
      const groups = hooks[spec.event] ?? [];
      const present = groups.some(
        (g) => g.matcher === spec.matcher && g.hooks.some((h) => h.command === spec.command),
      );
      if (present) continue;
      const group: HookGroup = {
        ...(spec.matcher === undefined ? {} : { matcher: spec.matcher }),
        hooks: [{ type: 'command', command: spec.command }],
      };
      hooks[spec.event] = [...groups, group];
      added.push(spec);
    }
    if (added.length > 0) await this.write(scope, { ...settings, hooks });
    return added;
  }

  async removeHooks(
    scope: SettingsScope,
    predicate: (command: string) => boolean,
  ): Promise<number> {
    const settings = await this.read(scope);
    if (!settings.hooks) return 0;
    let removed = 0;
    const hooks: Record<string, HookGroup[]> = {};
    for (const [event, groups] of Object.entries(settings.hooks)) {
      const kept = groups
        .map((g) => {
          const remaining = g.hooks.filter(
            (h) => !(h.command !== undefined && predicate(h.command)),
          );
          removed += g.hooks.length - remaining.length;
          return { ...g, hooks: remaining };
        })
        .filter((g) => g.hooks.length > 0);
      if (kept.length > 0) hooks[event] = kept;
    }
    if (removed === 0) return 0;
    const rest: Settings = { ...settings };
    delete rest.hooks;
    await this.write(scope, Object.keys(hooks).length > 0 ? { ...rest, hooks } : rest);
    return removed;
  }

  async listHooks(scope: SettingsScope): Promise<readonly HookSpec[]> {
    const settings = await this.read(scope);
    const out: HookSpec[] = [];
    for (const event of EVENTS) {
      for (const g of settings.hooks?.[event] ?? []) {
        for (const h of g.hooks) {
          if (h.command === undefined) continue;
          out.push({
            event,
            command: h.command,
            ...(g.matcher === undefined ? {} : { matcher: g.matcher }),
          });
        }
      }
    }
    return out;
  }

  async enabledPlugins(scope: SettingsScope): Promise<readonly string[]> {
    const parsed = enabledPluginsSchema.safeParse((await this.read(scope))['enabledPlugins']);
    if (!parsed.success) return [];
    return Object.entries(parsed.data)
      .filter(([, enabled]) => enabled === true)
      .map(([key]) => key);
  }

  private async read(scope: SettingsScope): Promise<Settings> {
    const path = this.settingsPath(scope);
    let text: string;
    try {
      text = await readFile(path, 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {};
      throw new ConfigError(`Cannot read ${path}`, { cause: error, io: true });
    }
    if (!text.trim()) return {};
    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch (cause) {
      throw new ConfigError(`${path} is not valid JSON; fix it before running cclens`, { cause });
    }
    const parsed = settingsSchema.safeParse(raw);
    if (!parsed.success) {
      throw new ConfigError(`${path} has an unexpected "hooks" shape; refusing to edit it`);
    }
    return parsed.data;
  }

  private async write(scope: SettingsScope, settings: Settings): Promise<void> {
    await writeFileAtomic(this.settingsPath(scope), `${JSON.stringify(settings, null, 2)}\n`);
  }
}

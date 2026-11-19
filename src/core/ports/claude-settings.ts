export type SettingsScope = 'user' | 'project';

/** A Claude Code hook entry cclens owns. */
export interface HookSpec {
  readonly event: 'PostToolUse' | 'UserPromptSubmit' | 'SessionStart' | 'Stop';
  readonly matcher?: string;
  readonly command: string;
}

export interface SettingsBackup {
  readonly scope: SettingsScope;
  readonly settingsPath: string;
  readonly backupPath: string;
  /** False when the settings file did not exist before; restore deletes it. */
  readonly existed: boolean;
}

/** Reads and safely edits Claude Code's settings.json (atomic writes, backups). */
export interface ClaudeSettingsManager {
  settingsPath(scope: SettingsScope): string;
  backup(scope: SettingsScope): Promise<SettingsBackup>;
  restore(backup: SettingsBackup): Promise<void>;
  /** Adds hooks not already present. Returns the hooks it actually added. */
  addHooks(scope: SettingsScope, hooks: readonly HookSpec[]): Promise<readonly HookSpec[]>;
  /** Removes hooks whose command matches. Returns how many were removed. */
  removeHooks(scope: SettingsScope, predicate: (command: string) => boolean): Promise<number>;
  listHooks(scope: SettingsScope): Promise<readonly HookSpec[]>;
  /** Keys of `enabledPlugins` set to true, e.g. `cclens@cclens`. */
  enabledPlugins(scope: SettingsScope): Promise<readonly string[]>;
}

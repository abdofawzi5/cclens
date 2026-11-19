import { defaultConfig } from '../../core/config/defaults.js';
import {
  cclensHookSpecs,
  isCclensHookCommand,
  isLegacyHookCommand,
} from '../../core/domain/hooks.js';
import type {
  ClaudeSettingsManager,
  SettingsBackup,
  SettingsScope,
} from '../../core/ports/claude-settings.js';
import type { ConfigStore } from '../../core/ports/infrastructure.js';
import type { InstallContext, InstallStep, StepOutcome } from '../../core/ports/install.js';
import type { UsageEventStore, UsageHistorySource } from '../../core/ports/usage.js';
import type { UsageService } from '../usage-service.js';

const BACKUP_KEY = 'settings-backup';

export class CreateConfigStep implements InstallStep {
  readonly id = 'config';
  readonly title = 'Create config';
  constructor(private readonly store: ConfigStore) {}

  async execute(ctx: InstallContext): Promise<StepOutcome> {
    if (await this.store.exists()) {
      return { status: 'skipped', message: `kept existing ${this.store.path}` };
    }
    if (ctx.dryRun) return { status: 'done', message: `would create ${this.store.path}` };
    await this.store.save(defaultConfig());
    return { status: 'done', message: `created ${this.store.path}` };
  }
}

export class CreateEventLogStep implements InstallStep {
  readonly id = 'event-log';
  readonly title = 'Create usage log';
  constructor(
    private readonly store: UsageEventStore,
    private readonly path: string,
  ) {}

  async execute(ctx: InstallContext): Promise<StepOutcome> {
    if (await this.store.exists()) {
      return { status: 'skipped', message: `kept existing ${this.path}` };
    }
    if (ctx.dryRun) return { status: 'done', message: `would create ${this.path}` };
    await this.store.ensure();
    return { status: 'done', message: `created ${this.path}` };
  }
}

export class BackupSettingsStep implements InstallStep {
  readonly id = 'backup-settings';
  readonly title = 'Back up Claude Code settings';
  constructor(
    private readonly settings: ClaudeSettingsManager,
    private readonly scope: SettingsScope,
  ) {}

  async execute(ctx: InstallContext): Promise<StepOutcome> {
    if (ctx.dryRun) {
      return { status: 'done', message: `would back up ${this.settings.settingsPath(this.scope)}` };
    }
    const backup = await this.settings.backup(this.scope);
    ctx.bag.set(BACKUP_KEY, backup);
    return backup.existed
      ? { status: 'done', message: `saved ${backup.backupPath}` }
      : { status: 'skipped', message: `${backup.settingsPath} does not exist yet` };
  }

  async undo(ctx: InstallContext): Promise<void> {
    const backup = ctx.bag.get(BACKUP_KEY) as SettingsBackup | undefined;
    if (backup) await this.settings.restore(backup);
  }
}

export class RegisterHooksStep implements InstallStep {
  readonly id = 'hooks';
  readonly title = 'Register Claude Code hooks';
  constructor(
    private readonly settings: ClaudeSettingsManager,
    private readonly scope: SettingsScope,
    private readonly runner: string,
  ) {}

  async execute(ctx: InstallContext): Promise<StepOutcome> {
    const specs = cclensHookSpecs(this.runner);
    if (ctx.dryRun) return { status: 'done', message: `would add ${specs.length} hooks` };
    // Replace stale cclens hooks (e.g. after cclens moved) with the current command.
    const current = new Set(specs.map((s) => s.command));
    await this.settings.removeHooks(this.scope, (c) => isCclensHookCommand(c) && !current.has(c));
    const added = await this.settings.addHooks(this.scope, specs);
    if (added.length === 0) return { status: 'skipped', message: 'hooks already registered' };
    const events = added.map((s) => s.event).join(', ');
    return {
      status: 'done',
      message: `added ${events} to ${this.settings.settingsPath(this.scope)}`,
    };
  }

  async undo(): Promise<void> {
    await this.settings.removeHooks(this.scope, isCclensHookCommand);
  }
}

/** Removes the manual pre-cclens hook so the same skill use is not logged twice. */
export class RemoveLegacyHookStep implements InstallStep {
  readonly id = 'legacy-hook';
  readonly title = 'Remove the old skill-usage hook';
  constructor(
    private readonly settings: ClaudeSettingsManager,
    private readonly scope: SettingsScope,
  ) {}

  async execute(ctx: InstallContext): Promise<StepOutcome> {
    const legacy = (await this.settings.listHooks(this.scope)).filter((h) =>
      isLegacyHookCommand(h.command),
    );
    if (legacy.length === 0) return { status: 'skipped', message: 'no old hook found' };
    if (ctx.dryRun) {
      return { status: 'done', message: `would remove ${legacy.length} old hook entries` };
    }
    const removed = await this.settings.removeHooks(this.scope, isLegacyHookCommand);
    return { status: 'done', message: `removed ${removed} old hook entries` };
  }
  // Undo is covered by BackupSettingsStep restoring the whole file.
}

export class ImportHistoryStep implements InstallStep {
  readonly id: string;
  readonly title: string;
  constructor(
    private readonly usage: UsageService,
    private readonly source: UsageHistorySource,
  ) {
    this.id = `import-${source.id}`;
    this.title = `Import ${source.description}`;
  }

  async execute(ctx: InstallContext): Promise<StepOutcome> {
    if (ctx.dryRun) return { status: 'done', message: `would import ${this.source.description}` };
    const report = await this.usage.import(this.source);
    if (report.read === 0) return { status: 'skipped', message: 'nothing to import' };
    if (report.imported === 0) {
      return { status: 'skipped', message: `all ${report.read} events already imported` };
    }
    return {
      status: 'done',
      message: `imported ${report.imported} events (${report.duplicates} already known)`,
    };
  }
}

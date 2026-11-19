import { isCclensHookCommand } from '../core/domain/hooks.js';
import type { ClaudeSettingsManager, SettingsScope } from '../core/ports/claude-settings.js';
import type { ConfigStore, Paths } from '../core/ports/infrastructure.js';
import type { HookRunnerStore, InstallStep } from '../core/ports/install.js';
import type { UsageEventStore, UsageHistorySource } from '../core/ports/usage.js';
import { InstallRunner, type InstallReport } from './install/install-runner.js';
import {
  BackupSettingsStep,
  CreateConfigStep,
  CreateEventLogStep,
  ImportHistoryStep,
  RegisterHooksStep,
  RemoveLegacyHookStep,
  RemoveSettingsHooksStep,
  WriteHookRunnerStep,
} from './install/steps.js';
import type { UsageService } from './usage-service.js';

/**
 * Who registers the Claude Code hooks: cclens itself in settings.json, or the cclens
 * plugin's `hooks/hooks.json`. Never both, so each skill use is recorded once (ADR 0006).
 */
export type HookOwner = 'settings' | 'plugin';

export interface InitOptions {
  readonly scope: SettingsScope;
  /** Defaults to `settings`. */
  readonly hooks?: HookOwner;
  /** Import past skill uses from Claude Code transcripts. */
  readonly backfill: boolean;
  /** Import the old log and remove the old hook. */
  readonly migrateLegacy: boolean;
  readonly dryRun: boolean;
}

export interface SetupDeps {
  readonly paths: Paths;
  readonly configStore: ConfigStore;
  readonly eventStore: UsageEventStore;
  readonly settings: ClaudeSettingsManager;
  readonly hookRunner: HookRunnerStore;
  readonly usage: UsageService;
  readonly legacySource: UsageHistorySource;
  readonly transcriptSource: UsageHistorySource;
  /** Shell command that starts this cclens CLI, written into the hooks. */
  readonly selfCommand: string;
}

/** `cclens init` and `cclens uninstall`. */
export class SetupService {
  constructor(
    private readonly deps: SetupDeps,
    private readonly runner = new InstallRunner(),
  ) {}

  /** The steps `init` would run, in order. Exposed for `--dry-run` and tests. */
  plan(options: InitOptions): readonly InstallStep[] {
    const d = this.deps;
    const steps: InstallStep[] = [
      new CreateConfigStep(d.configStore),
      new CreateEventLogStep(d.eventStore, d.paths.eventsFile),
      new BackupSettingsStep(d.settings, options.scope),
    ];
    if (options.migrateLegacy) steps.push(new RemoveLegacyHookStep(d.settings, options.scope));
    steps.push(
      options.hooks === 'plugin'
        ? new RemoveSettingsHooksStep(d.settings, options.scope)
        : new RegisterHooksStep(d.settings, options.scope, d.selfCommand),
      new WriteHookRunnerStep(d.hookRunner, d.selfCommand),
    );
    if (options.migrateLegacy) steps.push(new ImportHistoryStep(d.usage, d.legacySource));
    if (options.backfill) steps.push(new ImportHistoryStep(d.usage, d.transcriptSource));
    return steps;
  }

  init(options: InitOptions): Promise<InstallReport> {
    return this.runner.run(this.plan(options), { dryRun: options.dryRun });
  }

  /** Removes cclens hooks from both scopes. Data in the cclens home is kept. */
  async uninstall(): Promise<{ readonly removed: Readonly<Record<SettingsScope, number>> }> {
    const scopes: readonly SettingsScope[] = ['user', 'project'];
    const removed = { user: 0, project: 0 };
    for (const scope of scopes) {
      removed[scope] = await this.deps.settings.removeHooks(scope, isCclensHookCommand);
    }
    return { removed };
  }
}

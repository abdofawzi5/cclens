import {
  isCclensHookCommand,
  isCclensPluginKey,
  isLegacyHookCommand,
} from '../core/domain/hooks.js';
import { describeError } from '../core/errors.js';
import type { ClaudeSettingsManager, HookSpec } from '../core/ports/claude-settings.js';
import type { ConfigStore, FileProbe, Paths } from '../core/ports/infrastructure.js';
import type { CheckResult, HealthCheck, HookRunnerStore } from '../core/ports/install.js';
import type { UsageService } from './usage-service.js';

export interface DoctorDeps {
  readonly paths: Paths;
  readonly configStore: ConfigStore;
  readonly settings: ClaudeSettingsManager;
  readonly hookRunner: HookRunnerStore;
  readonly usage: UsageService;
  readonly files: FileProbe;
  readonly nodeVersion: string;
}

type Outcome = Omit<CheckResult, 'id' | 'title'>;

const check = (id: string, title: string, run: () => Promise<Outcome>): HealthCheck => ({
  id,
  title,
  run,
});

/** Paths inside double quotes in a hook command, e.g. the node binary and cli.js. */
function quotedPaths(command: string): string[] {
  return [...command.matchAll(/"([^"]+)"/g)].map((m) => m[1]).filter((p): p is string => !!p);
}

/** `cclens doctor`: runs independent health checks and reports each one. */
export class DoctorService {
  constructor(private readonly deps: DoctorDeps) {}

  checks(): readonly HealthCheck[] {
    const d = this.deps;
    const allHooks = async (): Promise<HookSpec[]> => [
      ...(await d.settings.listHooks('user')),
      ...(await d.settings.listHooks('project')),
    ];
    const settingsHooks = async (): Promise<HookSpec[]> =>
      (await allHooks()).filter((h) => isCclensHookCommand(h.command));
    const pluginEnabled = async (): Promise<boolean> =>
      [
        ...(await d.settings.enabledPlugins('user')),
        ...(await d.settings.enabledPlugins('project')),
      ].some(isCclensPluginKey);

    return [
      check('node', 'Node.js version', () => {
        const major = Number(d.nodeVersion.replace(/^v/, '').split('.')[0]);
        return Promise.resolve(
          major >= 20
            ? { status: 'ok', message: d.nodeVersion }
            : {
                status: 'fail',
                message: `${d.nodeVersion} is too old`,
                fix: 'Install Node.js 20 or newer',
              },
        );
      }),
      check('config', 'cclens config', async () => {
        if (!(await d.configStore.exists())) {
          return { status: 'warn', message: 'no config file; defaults in use', fix: 'cclens init' };
        }
        await d.configStore.load();
        return { status: 'ok', message: d.configStore.path };
      }),
      check('event-log', 'Usage log', async () => {
        if (!(await d.files.exists(d.paths.eventsFile))) {
          return { status: 'fail', message: 'missing', fix: 'cclens init' };
        }
        const total = await d.usage.total();
        return { status: 'ok', message: `${total} skill uses recorded in ${d.paths.eventsFile}` };
      }),
      check('hooks', 'Claude Code hooks', async () => {
        const events = new Set((await settingsHooks()).map((h) => h.event));
        if (events.has('PostToolUse') && events.has('UserPromptSubmit')) {
          return { status: 'ok', message: 'PostToolUse (Skill) and UserPromptSubmit registered' };
        }
        if (await pluginEnabled()) {
          return { status: 'ok', message: 'registered by the cclens Claude Code plugin' };
        }
        return {
          status: 'fail',
          message: events.size === 0 ? 'not registered' : 'only partly registered',
          fix: 'cclens init (or install the cclens Claude Code plugin)',
        };
      }),
      check('hook-owner', 'One hook source', async () => {
        const inSettings = (await settingsHooks()).length > 0;
        const plugin = await pluginEnabled();
        if (inSettings && plugin) {
          return {
            status: 'warn',
            message:
              'both settings.json and the cclens plugin register hooks; the plugin stands down so uses are counted once',
            fix: 'Keep one: `cclens init --plugin` to use the plugin only, or disable the plugin',
          };
        }
        if (plugin) return { status: 'ok', message: 'the cclens plugin' };
        return { status: 'ok', message: inSettings ? 'settings.json' : 'none' };
      }),
      check('hook-target', 'Hook command target', async () => {
        const first = (await settingsHooks())[0];
        if (first) return this.targetOf(first.command, 'cclens init');
        if (!(await pluginEnabled())) return { status: 'warn', message: 'no cclens hook to check' };
        const runner = await d.hookRunner.read();
        if (runner === undefined) {
          return {
            status: 'fail',
            message: `the plugin cannot find cclens: ${d.hookRunner.path} is missing`,
            fix: 'npm i -g cclens && cclens init --plugin',
          };
        }
        return this.targetOf(runner, 'cclens init --plugin');
      }),
      check('legacy-hook', 'Old skill-usage hook', async () => {
        const legacy = (await allHooks()).filter((h) => isLegacyHookCommand(h.command));
        return legacy.length === 0
          ? { status: 'ok', message: 'not present' }
          : {
              status: 'warn',
              message: 'still registered; skill uses are logged twice',
              fix: 'cclens init (removes it and imports its log)',
            };
      }),
    ];
  }

  /** Checks that the absolute paths in a hook command line still exist. */
  private async targetOf(command: string, fix: string): Promise<Outcome> {
    const paths = quotedPaths(command);
    const missing: string[] = [];
    for (const p of paths) if (!(await this.deps.files.exists(p))) missing.push(p);
    return missing.length === 0
      ? { status: 'ok', message: paths.join(' ') || command }
      : {
          status: 'fail',
          message: `missing: ${missing.join(', ')}`,
          fix: `Re-run \`${fix}\` after moving or upgrading cclens or Node.js`,
        };
  }

  async run(): Promise<readonly CheckResult[]> {
    const results: CheckResult[] = [];
    for (const c of this.checks()) {
      try {
        results.push({ id: c.id, title: c.title, ...(await c.run()) });
      } catch (error) {
        results.push({ id: c.id, title: c.title, status: 'fail', message: describeError(error) });
      }
    }
    return results;
  }
}

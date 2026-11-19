import { Option, type Command } from 'commander';
import type { SettingsScope } from '../../../core/ports/claude-settings.js';
import { InstallReportRenderer } from '../../render/report-renderers.js';
import { isBudgetSet } from '../../../core/domain/budget.js';
import type { CliCommand, CommandContext } from '../command.js';
import { formatOf } from '../options.js';

interface InitFlags {
  scope: SettingsScope;
  backfill: boolean;
  migrate: boolean;
  dryRun: boolean;
  plugin: boolean;
}

/** `cclens init`: create data files, register hooks, import history. Safe to re-run. */
export class InitCommand implements CliCommand {
  register(program: Command, ctx: CommandContext): void {
    program
      .command('init')
      .description('set up cclens: create its data files and register Claude Code hooks')
      .addOption(
        new Option('--scope <scope>', 'where to register hooks')
          .choices(['user', 'project'])
          .default('user'),
      )
      .option('--backfill', 'import past skill uses from Claude Code transcripts', false)
      .option('--no-migrate', 'leave the old skill-usage hook and log alone')
      .option(
        '--plugin',
        'the cclens Claude Code plugin records skill uses: keep cclens hooks out of settings.json',
        false,
      )
      .option('--dry-run', 'show what would change without changing anything', false)
      .action(async (flags: InitFlags) => {
        const report = await ctx.services.setup.init({
          scope: flags.scope,
          hooks: flags.plugin ? 'plugin' : 'settings',
          backfill: flags.backfill,
          migrateLegacy: flags.migrate,
          dryRun: flags.dryRun,
        });
        const format = formatOf(program);
        ctx.print(ctx.renderer(format, new InstallReportRenderer()).render(report));
        if (!report.ok) process.exitCode = 1;
        if (format !== 'json' && report.ok && !flags.dryRun) {
          const budget = await ctx.services.budget.budget().catch(() => undefined);
          if (budget && !isBudgetSet(budget)) {
            ctx.print(
              'Tip: get one warning line in Claude Code when spend passes a limit: cclens budget set --daily <usd>',
            );
          }
        }
      });
  }
}

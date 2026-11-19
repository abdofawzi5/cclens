import { Option, type Command } from 'commander';
import type { SettingsScope } from '../../../core/ports/claude-settings.js';
import { InstallReportRenderer } from '../../render/report-renderers.js';
import type { CliCommand, CommandContext } from '../command.js';
import { formatOf } from '../options.js';

interface InitFlags {
  scope: SettingsScope;
  backfill: boolean;
  migrate: boolean;
  dryRun: boolean;
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
      .option('--dry-run', 'show what would change without changing anything', false)
      .action(async (flags: InitFlags) => {
        const report = await ctx.services.setup.init({
          scope: flags.scope,
          backfill: flags.backfill,
          migrateLegacy: flags.migrate,
          dryRun: flags.dryRun,
        });
        ctx.print(ctx.renderer(formatOf(program), new InstallReportRenderer()).render(report));
        if (!report.ok) process.exitCode = 1;
      });
  }
}

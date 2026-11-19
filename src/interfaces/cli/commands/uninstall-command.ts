import type { Command } from 'commander';
import type { CliCommand, CommandContext } from '../command.js';
import { formatOf } from '../options.js';

/** `cclens uninstall`: removes the hooks; keeps recorded data. */
export class UninstallCommand implements CliCommand {
  register(program: Command, ctx: CommandContext): void {
    program
      .command('uninstall')
      .description('remove cclens hooks from Claude Code (your recorded data is kept)')
      .action(async () => {
        const result = await ctx.services.setup.uninstall();
        if (formatOf(program) === 'json') {
          ctx.print(JSON.stringify(result, null, 2));
          return;
        }
        const total = result.removed.user + result.removed.project;
        ctx.print(
          total > 0
            ? `Removed ${total} cclens hook entries. Your data is still in ${ctx.container.paths.home}.`
            : 'No cclens hooks were registered.',
        );
      });
  }
}

import type { Command } from 'commander';
import { HookHandler } from '../../hook/hook-handler.js';
import { readStdin } from '../../hook/read-stdin.js';
import type { CliCommand, CommandContext } from '../command.js';

/**
 * `cclens hook`: called by Claude Code with the hook payload on stdin.
 * Hidden from help. Always exits 0 and prints nothing, so Claude is never affected.
 */
export class HookCommand implements CliCommand {
  register(program: Command, ctx: CommandContext): void {
    program
      .command('hook', { hidden: true })
      .description('internal: record a skill use from a Claude Code hook payload on stdin')
      .action(async () => {
        const handler = new HookHandler(ctx.services.usage, ctx.container.logger);
        await handler.handle(await readStdin(process.stdin));
        process.exitCode = 0;
      });
  }
}

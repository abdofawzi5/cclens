import type { Command } from 'commander';
import type { CliCommand } from '../command.js';

/**
 * Registers `cclens statusline` for help and docs only. main.ts runs it on a fast
 * path before commander loads (see interfaces/statusline/statusline.ts).
 */
export class StatuslineCommand implements CliCommand {
  register(program: Command): void {
    program
      .command('statusline')
      .description(
        "one line for Claude Code's status line: today's and this month's estimated spend",
      )
      .option('--with-ccusage', "put ccusage's status line in front of cclens's")
      .addHelpText(
        'after',
        '\nIn ~/.claude/settings.json:\n  "statusLine": { "type": "command", "command": "cclens statusline" }',
      )
      .action(async (flags: { withCcusage?: boolean }) => {
        const { runStatusline } = await import('../../statusline/statusline.js');
        await runStatusline(flags.withCcusage ? ['--with-ccusage'] : []);
      });
  }
}

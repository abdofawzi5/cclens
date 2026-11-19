import type { Command } from 'commander';
import { KeyValueRenderer } from '../../render/key-value-renderer.js';
import type { CliCommand, CommandContext } from '../command.js';
import { formatOf } from '../options.js';

/** `cclens paths`: shows where cclens and Claude Code keep their data. */
export class PathsCommand implements CliCommand {
  register(program: Command, ctx: CommandContext): void {
    program
      .command('paths')
      .description('show where cclens and Claude Code store their data')
      .action(() => {
        const renderer = ctx.renderer(formatOf(program), new KeyValueRenderer());
        ctx.print(renderer.render(ctx.container.paths));
      });
  }
}

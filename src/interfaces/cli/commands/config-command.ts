import type { Command } from 'commander';
import { KeyValueRenderer } from '../../render/key-value-renderer.js';
import type { CliCommand, CommandContext } from '../command.js';
import { formatOf } from '../options.js';

/** `cclens config show|path|validate`. */
export class ConfigCommand implements CliCommand {
  register(program: Command, ctx: CommandContext): void {
    const config = program.command('config').description('inspect the cclens configuration');

    config
      .command('path')
      .description('print the config file location')
      .action(() => {
        ctx.print(ctx.services.config.path);
      });

    config
      .command('show')
      .description('print the effective configuration (defaults applied)')
      .action(async () => {
        const data = await ctx.services.config.load();
        const renderer = ctx.renderer(formatOf(program), new KeyValueRenderer());
        ctx.print(renderer.render(data));
      });

    config
      .command('validate')
      .description('check the config file and report problems')
      .action(async () => {
        await ctx.services.config.load();
        ctx.print('Config is valid.');
      });
  }
}

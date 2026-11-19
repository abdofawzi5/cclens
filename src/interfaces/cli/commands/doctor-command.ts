import type { Command } from 'commander';
import { DoctorRenderer } from '../../render/report-renderers.js';
import type { CliCommand, CommandContext } from '../command.js';
import { formatOf } from '../options.js';

/** `cclens doctor`: checks the installation and says how to fix problems. */
export class DoctorCommand implements CliCommand {
  register(program: Command, ctx: CommandContext): void {
    program
      .command('doctor')
      .description('check that cclens is installed and recording correctly')
      .action(async () => {
        const results = await ctx.services.doctor.run();
        ctx.print(ctx.renderer(formatOf(program), new DoctorRenderer()).render(results));
        if (results.some((r) => r.status === 'fail')) process.exitCode = 1;
      });
  }
}

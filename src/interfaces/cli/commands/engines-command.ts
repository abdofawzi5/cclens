import { readFile } from 'node:fs/promises';
import type { Command } from 'commander';
import pc from 'picocolors';
import type { EngineRow } from '../../../app/search/engine-service.js';
import type { EngineOutcome } from '../../../core/domain/search.js';
import { ConfigError } from '../../../core/errors.js';
import { outcomeLine } from '../../render/search-renderer.js';
import { TableRenderer } from '../../render/table-renderer.js';
import type { CliCommand, CommandContext } from '../command.js';
import { formatOf } from '../options.js';

const engineTable = new TableRenderer<EngineRow>(
  [
    { header: 'Id', value: (r) => r.config.id },
    { header: 'Enabled', value: (r) => (r.config.enabled ? pc.green('yes') : pc.dim('no')) },
    { header: 'Engine', value: (r) => r.descriptor?.name ?? r.config.type },
    {
      header: 'API',
      value: (r) =>
        r.descriptor?.stability === 'unofficial' ? pc.yellow('unofficial') : 'official',
    },
    { header: 'Timeout', value: (r) => `${r.config.timeoutMs / 1000}s`, align: 'right' },
    {
      header: 'Cache',
      value: (r) => `${Math.round(r.config.cacheTtlSeconds / 60)} min`,
      align: 'right',
    },
  ],
  { footer: () => pc.dim('Turn engines on or off with `cclens engines enable|disable <id>`.') },
);

/** `cclens engines`: list, enable, disable, add, remove and test search engines. */
export class EnginesCommand implements CliCommand {
  register(program: Command, ctx: CommandContext): void {
    const engines = program.command('engines').description('manage skill search engines');
    const list = async (): Promise<void> => {
      const rows = await ctx.services.engines.list();
      ctx.print(ctx.renderer(formatOf(program), engineTable).render(rows));
    };
    engines.action(list);
    engines.command('list').description('list engines and their settings').action(list);

    for (const enabled of [true, false]) {
      engines
        .command(enabled ? 'enable' : 'disable')
        .description(`${enabled ? 'turn on' : 'turn off'} an engine`)
        .argument('<id>')
        .action(async (id: string) => {
          await ctx.services.engines.setEnabled(id, enabled);
          ctx.print(`${id} ${enabled ? 'enabled' : 'disabled'}.`);
        });
    }

    engines
      .command('add')
      .description('add an engine from a JSON file (see docs for the generic-http format)')
      .argument('<file>', 'engine definition, e.g. engine.json')
      .action(async (file: string) => {
        let definition: unknown;
        try {
          definition = JSON.parse(await readFile(file, 'utf8'));
        } catch (cause) {
          throw new ConfigError(`Could not read ${file} as JSON.`, { cause });
        }
        const engine = await ctx.services.engines.add(definition);
        ctx.print(`Added ${engine.id}. Try it with \`cclens engines test ${engine.id}\`.`);
      });

    engines
      .command('remove')
      .description('remove an engine from the config')
      .argument('<id>')
      .action(async (id: string) => {
        await ctx.services.engines.remove(id);
        ctx.print(`${id} removed.`);
      });

    engines
      .command('test')
      .description('run a small live search to check engines (all enabled ones by default)')
      .argument('[id]')
      .action(async (id?: string) => {
        const outcomes: readonly EngineOutcome[] = await ctx.services.engines.test(id);
        if (formatOf(program) === 'json') {
          ctx.print(JSON.stringify(outcomes, null, 2));
          return;
        }
        const rows = await ctx.services.engines.list();
        const unofficial = new Set(
          rows.filter((r) => r.descriptor?.stability === 'unofficial').map((r) => r.config.id),
        );
        ctx.print(outcomes.map((o) => outcomeLine(o, unofficial)).join('\n'));
        if (outcomes.some((o) => !o.ok)) process.exitCode = 1;
      });
  }
}

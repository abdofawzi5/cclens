import { Option, type Command } from 'commander';
import pc from 'picocolors';
import { USAGE_GROUPINGS, type UsageGrouping } from '../../../app/usage-service.js';
import { TableRenderer } from '../../render/table-renderer.js';
import type { CliCommand, CommandContext } from '../command.js';
import { parseDateOption, parsePositiveInt } from '../dates.js';
import { formatOf } from '../options.js';

interface UsageFlags {
  by: UsageGrouping;
  since?: Date;
  until?: Date;
  skill?: string;
  project?: string;
  limit?: number;
}

interface Row {
  readonly key: string;
  readonly uses: number;
}

const HEADERS: Record<UsageGrouping, string> = {
  skill: 'Skill',
  day: 'Day',
  project: 'Project',
  source: 'Captured by',
};

/** `cclens usage`: recorded skill uses, grouped by skill, day, project or source. */
export class UsageCommand implements CliCommand {
  register(program: Command, ctx: CommandContext): void {
    program
      .command('usage')
      .description('show how many times skills were used')
      .addOption(
        new Option('--by <grouping>', 'group uses by')
          .choices(Object.keys(USAGE_GROUPINGS))
          .default('skill'),
      )
      .option('--since <date>', 'from this date (YYYY-MM-DD or 7d, 4w, 3m)', (v) =>
        parseDateOption(v),
      )
      .option('--until <date>', 'up to this date', (v) => parseDateOption(v))
      .option('--skill <id>', 'only this skill')
      .option('--project <name>', 'only this project folder')
      .option('--limit <n>', 'show at most n rows', parsePositiveInt)
      .action(async (flags: UsageFlags) => {
        const counts = await ctx.services.usage.countBy(USAGE_GROUPINGS[flags.by], {
          ...(flags.since ? { since: flags.since } : {}),
          ...(flags.until ? { until: flags.until } : {}),
          ...(flags.skill ? { skill: flags.skill } : {}),
          ...(flags.project ? { project: flags.project } : {}),
        });
        let rows: Row[] = [...counts].map(([key, uses]) => ({ key, uses }));
        if (flags.by === 'day') rows.sort((a, b) => a.key.localeCompare(b.key));
        if (flags.limit) rows = rows.slice(0, flags.limit);
        const total = [...counts.values()].reduce((a, b) => a + b, 0);

        if (formatOf(program) === 'json') {
          ctx.print(JSON.stringify({ by: flags.by, total, rows }, null, 2));
          return;
        }
        const table = new TableRenderer<Row>(
          [
            { header: HEADERS[flags.by], value: (r) => r.key },
            { header: 'Uses', value: (r) => r.uses, align: 'right' },
          ],
          { footer: () => pc.dim(`${total} skill uses in total`) },
        );
        ctx.print(table.render(rows));
      });
  }
}

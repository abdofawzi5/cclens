import { Option, type Command } from 'commander';
import pc from 'picocolors';
import type { InventoryReport, SkillRow } from '../../../app/inventory/inventory-service.js';
import type { SkillScope } from '../../../core/domain/skill.js';
import { truncate } from '../../render/format.js';
import { TableRenderer } from '../../render/table-renderer.js';
import type { CliCommand, CommandContext } from '../command.js';
import { parseDateOption } from '../dates.js';
import { formatOf } from '../options.js';

interface SkillsFlags {
  scope?: SkillScope;
  plugin?: string;
  unused: boolean;
  since?: Date;
  byPlugin: boolean;
}

const skillTable = new TableRenderer<SkillRow>([
  { header: 'Skill', value: (r) => r.id },
  { header: 'Source', value: (r) => r.plugin ?? r.scope },
  { header: 'Uses', value: (r) => r.uses, align: 'right' },
  { header: 'Description', value: (r) => truncate(r.description ?? '', 60) },
]);

const pluginTable = new TableRenderer<InventoryReport['byPlugin'][number]>([
  { header: 'Plugin', value: (r) => r.plugin },
  { header: 'Skills', value: (r) => r.skills, align: 'right' },
  { header: 'Uses', value: (r) => r.uses, align: 'right' },
]);

function summary(report: InventoryReport, flags: SkillsFlags): string {
  const s = report.byScope;
  const window = flags.since ? ` since ${flags.since.toLocaleDateString()}` : '';
  const lines = [
    `${pc.bold(String(report.total))} installed skills  ` +
      pc.dim(`(${s.plugin} plugin, ${s.personal} personal, ${s.project} project)`),
    `Showing ${report.skills.length}${flags.unused ? ' unused' : ''}; uses counted${window || ' over all recorded history'}.`,
  ];
  if (report.unknownUses.size > 0) {
    const names = [...report.unknownUses.keys()].slice(0, 5).join(', ');
    lines.push(
      pc.dim(`Also used but not installed here: ${names}${report.unknownUses.size > 5 ? '…' : ''}`),
    );
  }
  return lines.join('\n');
}

/** `cclens skills`: installed skills with use counts. */
export class SkillsCommand implements CliCommand {
  register(program: Command, ctx: CommandContext): void {
    program
      .command('skills')
      .description('list installed skills and how often each was used')
      .addOption(
        new Option('--scope <scope>', 'only this kind of skill').choices([
          'personal',
          'project',
          'plugin',
        ]),
      )
      .option('--plugin <name>', 'only skills from this plugin')
      .option('--unused', 'only skills never used in the window', false)
      .option('--since <date>', 'count uses from this date (YYYY-MM-DD or 7d, 4w, 3m)', (v) =>
        parseDateOption(v),
      )
      .option('--by-plugin', 'summarise per plugin instead of per skill', false)
      .action(async (flags: SkillsFlags) => {
        const report = await ctx.services.inventory.report({
          ...(flags.scope ? { scope: flags.scope } : {}),
          ...(flags.plugin ? { plugin: flags.plugin } : {}),
          unusedOnly: flags.unused,
          ...(flags.since ? { usage: { since: flags.since } } : {}),
        });
        if (formatOf(program) === 'json') {
          ctx.print(ctx.renderer('json', skillTable).render(report));
          return;
        }
        const body = flags.byPlugin
          ? pluginTable.render(report.byPlugin)
          : skillTable.render(report.skills);
        ctx.print(`${summary(report, flags)}\n${body}`);
      });
  }
}

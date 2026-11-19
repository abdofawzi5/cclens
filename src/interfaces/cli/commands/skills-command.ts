import { Option, type Command } from 'commander';
import pc from 'picocolors';
import type { InventoryReport, SkillRow } from '../../../app/inventory/inventory-service.js';
import type { FixHint } from '../../../core/domain/fix-hints.js';
import type { SkillScope } from '../../../core/domain/skill.js';
import { compact } from '../../../core/util/format.js';
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
  fix: boolean;
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

function groupName(h: FixHint): string {
  return h.group.plugin ?? h.group.skillId ?? '';
}

function size(h: FixHint): string {
  const n = h.group.skills;
  return `${String(n)} ${n === 1 ? 'skill' : 'skills'}, ~${compact(h.group.tokens)} tokens`;
}

/** `--fix`: commands to stop listing unused plugins and skills. Printed, never run. */
export function renderFixHints(hints: readonly FixHint[], window: string): string {
  if (hints.length === 0)
    return `Every installed plugin and skill was used${window}. Nothing to turn off.`;
  const tokens = hints.reduce((n, h) => n + h.group.tokens, 0);
  const plugins = hints.filter((h) => h.group.plugin).length;
  const out = [
    `Unused${window}: ${String(plugins)} plugins and ${String(hints.length - plugins)} standalone skills, ` +
      `~${compact(tokens)} listing tokens on every request.`,
  ];
  const commands = hints.filter((h) => h.kind === 'command');
  if (commands.length > 0) {
    const width = Math.max(...commands.map((h) => h.command.length));
    out.push('', 'Run these yourself to stop listing them (cclens never runs them):');
    for (const h of commands) {
      const note = h.note ? `; ${h.note}` : '';
      out.push(`  ${h.command.padEnd(width)}  ${pc.dim(`# ${size(h)}${note}`)}`);
    }
  }
  const manual = hints.filter((h) => h.kind === 'manual');
  if (manual.length > 0) {
    out.push('', 'No command for these:');
    for (const h of manual)
      out.push(`  ${pc.bold(groupName(h))} ${pc.dim(`(${size(h)})`)}: ${h.note}`);
  }
  out.push(
    '',
    pc.dim('Uses are only known since cclens started recording; check before turning off.'),
  );
  return out.join('\n');
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
      .option(
        '--fix',
        'print the commands that turn off unused plugins (cclens never runs them)',
        false,
      )
      .action(async (flags: SkillsFlags) => {
        if (flags.fix) {
          const hints = await ctx.services.inventory.fixHints(
            flags.since ? { since: flags.since } : undefined,
          );
          const window = flags.since ? ` since ${flags.since.toLocaleDateString()}` : '';
          ctx.print(
            formatOf(program) === 'json'
              ? ctx.renderer('json', skillTable).render(hints)
              : renderFixHints(hints, window),
          );
          return;
        }
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
          ? pluginTable.render(
              flags.unused ? report.byPlugin.filter((p) => p.uses === 0) : report.byPlugin,
            )
          : skillTable.render(report.skills);
        ctx.print(`${summary(report, flags)}\n${body}`);
      });
  }
}

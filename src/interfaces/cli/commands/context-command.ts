import type { Command } from 'commander';
import pc from 'picocolors';
import type { ContextReport } from '../../../app/context-service.js';
import type {
  InstructionFile,
  McpServerTools,
  OverheadPartSummary,
} from '../../../core/domain/overhead.js';
import { compact, localDay, percent } from '../../../core/util/format.js';
import { truncate } from '../../render/format.js';
import { TableRenderer } from '../../render/table-renderer.js';
import type { CliCommand, CommandContext } from '../command.js';
import { parseDateOption } from '../dates.js';
import { formatOf } from '../options.js';

interface ContextFlags {
  since?: Date;
  last?: boolean;
}

const UUID_LIKE = /^[0-9a-f]{8}-[0-9a-f]{4}-/;

/** `1a59c906-04da-…` keys are claude.ai connectors; the transcript has no name for them. */
export function serverLabel(server: string): string {
  if (UUID_LIKE.test(server)) return `claude.ai connector ${server.slice(0, 8)}`;
  return server.replace(/^plugin_/, 'plugin ');
}

const NOTES: Partial<Record<OverheadPartSummary['part'], string>> = {
  unrecorded: 'not in the transcript: built-in and loaded tool schemas, etc.',
  'tool-names': 'one line per tool that loads on demand',
};

function partNote(p: OverheadPartSummary, r: ContextReport): string {
  const latest = r.latest;
  if (p.part === 'tool-names' && latest) {
    const mcp = latest.mcpServers.reduce((n, s) => n + s.tools, 0);
    return `${String(latest.toolNames)} tools, ${String(mcp)} from ${String(latest.mcpServers.length)} MCP servers`;
  }
  if (p.part === 'skills' && latest?.skills !== undefined) return `${String(latest.skills)} skills`;
  if (p.part === 'instructions' && latest && latest.instructionFiles.length > 0) {
    return `${String(latest.instructionFiles.length)} files in the latest session`;
  }
  return NOTES[p.part] ?? '';
}

const serverTable = new TableRenderer<McpServerTools>([
  { header: 'MCP server', value: (s) => truncate(serverLabel(s.server), 40) },
  { header: 'For example', value: (s) => truncate(s.example ?? '', 30) },
  { header: 'Tools', value: (s) => s.tools, align: 'right' },
  { header: 'Tokens', value: (s) => `~${compact(s.tokens)}`, align: 'right' },
]);

const fileTable = new TableRenderer<InstructionFile>([
  { header: 'File', value: (f) => truncate(f.path.replace(/^\/Users\/[^/]+/, '~'), 60) },
  { header: 'Kind', value: (f) => f.kind },
  { header: 'Tokens', value: (f) => `~${compact(f.tokens)}`, align: 'right' },
]);

export function renderContext(r: ContextReport): string {
  if (r.sessions === 0) {
    return `No sessions since ${localDay(r.since)} with a recorded first reply. Try --since 30d.`;
  }
  const scope =
    r.sessions === 1
      ? 'in the latest session'
      : `on average over ${String(r.sessions)} sessions since ${localDay(r.since)}`;
  const parts = new TableRenderer<OverheadPartSummary>([
    { header: 'Part', value: (p) => p.label },
    { header: 'Tokens', value: (p) => `~${compact(p.tokens)}`, align: 'right' },
    { header: 'Share', value: (p) => percent(p.share), align: 'right' },
    { header: 'Detail', value: (p) => partNote(p, r) },
  ]);
  const out = [
    `Before your first prompt, Claude Code sends ${pc.bold(compact(r.averageTokens))} tokens ${scope}.`,
    pc.dim('Every reply sends it again (mostly read from cache).'),
    parts.render(r.parts),
  ];
  const latest = r.latest;
  if (latest && latest.mcpServers.length > 0) {
    out.push(
      '',
      pc.bold('MCP servers in the latest session'),
      serverTable.render(latest.mcpServers.slice(0, 10)),
    );
    if (latest.mcpServers.length > 10) {
      out.push(pc.dim(`…and ${String(latest.mcpServers.length - 10)} more (--json for all)`));
    }
  }
  if (latest && latest.instructionFiles.length > 0) {
    out.push(
      '',
      pc.bold('CLAUDE.md and memory files in the latest session'),
      fileTable.render(latest.instructionFiles),
    );
  }
  out.push(
    '',
    pc.dim(
      'The total is exact (the first reply’s usage); parts are estimated at ~4 characters per token.',
    ),
    pc.dim(
      'To trim: `cclens skills --unused --by-plugin --fix`, and disconnect MCP servers you do not use.',
    ),
  );
  return out.join('\n');
}

/** `cclens context`: what fills the context before you type anything (PLAN A2). */
export class ContextCommand implements CliCommand {
  register(program: Command, ctx: CommandContext): void {
    program
      .command('context')
      .description('what Claude Code sends before your first prompt: tools, skills, CLAUDE.md')
      .option(
        '--since <date>',
        'sessions from this date (YYYY-MM-DD or 7d, 4w, 3m; default 14d)',
        (v) => parseDateOption(v),
      )
      .option('--last', 'only the most recent session')
      .action(async (flags: ContextFlags) => {
        const report = await ctx.services.context.report({
          ...(flags.since ? { since: flags.since } : {}),
          ...(flags.last ? { last: true } : {}),
        });
        ctx.print(
          formatOf(program) === 'json'
            ? ctx.renderer('json', { render: () => '' }).render(report)
            : renderContext(report),
        );
      });
  }
}

import { InvalidArgumentError, type Command } from 'commander';
import { extname, join, resolve } from 'node:path';
import { localDay } from '../../../core/util/format.js';
import { ChartJsRenderer } from '../../render/report/chartjs-renderer.js';
import { HtmlReportRenderer } from '../../render/report/html-report-renderer.js';
import { MarkdownReportRenderer } from '../../render/report/markdown-report-renderer.js';
import { JsonRenderer } from '../../render/json-renderer.js';
import type { Renderer } from '../../render/renderer.js';
import type { CliCommand, CommandContext } from '../command.js';
import { parseDateOption, parsePositiveInt } from '../dates.js';
import { formatOf } from '../options.js';

type ReportFormat = 'md' | 'html' | 'json';
const FORMATS: readonly ReportFormat[] = ['md', 'html', 'json'];
const DAY_MS = 86_400_000;

interface ReportFlags {
  days?: number;
  since?: Date;
  format?: ReportFormat;
  out?: string;
  open?: boolean;
  top?: number;
}

function parseFormat(value: string): ReportFormat {
  const f = value.toLowerCase().replace(/^markdown$/, 'md');
  if ((FORMATS as readonly string[]).includes(f)) return f as ReportFormat;
  throw new InvalidArgumentError(`use one of: ${FORMATS.join(', ')}`);
}

/** The format the user asked for, else the one the output file implies, else Markdown (HTML with --open). */
export function reportFormat(flags: Pick<ReportFlags, 'format' | 'out' | 'open'>): ReportFormat {
  if (flags.format) return flags.format;
  const ext = flags.out ? extname(flags.out).toLowerCase() : '';
  if (ext === '.html' || ext === '.htm') return 'html';
  if (ext === '.json') return 'json';
  if (ext === '.md') return 'md';
  return flags.open || flags.out ? 'html' : 'md';
}

/** Whole days from local midnight of `since` through today, inclusive. */
export function daysSince(since: Date, now: Date): number {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const start = new Date(since.getFullYear(), since.getMonth(), since.getDate());
  return Math.max(1, Math.round((today.getTime() - start.getTime()) / DAY_MS) + 1);
}

/** `cclens report`: usage, costliest sessions, unused skills and findings as Markdown, JSON or a charted HTML page. */
export class ReportCommand implements CliCommand {
  register(program: Command, ctx: CommandContext): void {
    program
      .command('report')
      .description('usage report with charts: Markdown, JSON, or a self-contained HTML page')
      .option(
        '--days <n>',
        'look back this many days (default: config review.windowDays)',
        parsePositiveInt,
      )
      .option('--since <date>', 'from this date (YYYY-MM-DD or 7d, 4w, 3m)', (v) =>
        parseDateOption(v),
      )
      .option(
        '--format <format>',
        'md, html or json (default: md, or html with --open)',
        parseFormat,
      )
      .option('--out <file>', 'write to this file (HTML goes to ~/.cclens/reports/ by default)')
      .option('--open', 'open the report in your browser (implies HTML)')
      .option(
        '--top <n>',
        'how many of the costliest sessions to list (default 10)',
        parsePositiveInt,
      )
      .action(async (flags: ReportFlags) => {
        const now = ctx.container.clock.now();
        const windowDays = flags.since ? daysSince(flags.since, now) : flags.days;
        const report = await ctx.services.report.build({
          ...(windowDays ? { windowDays } : {}),
          ...(flags.top ? { topSessions: flags.top } : {}),
        });

        // Global --json prints the model, whatever --format says.
        const format: ReportFormat = formatOf(program) === 'json' ? 'json' : reportFormat(flags);
        const home = ctx.container.paths.claudeHome.replace(/[\\/]\.claude$/, '');
        let renderer: Renderer;
        if (format === 'json') renderer = new JsonRenderer();
        else if (format === 'md') renderer = new MarkdownReportRenderer(home);
        else {
          const script = await ctx.container.chartScript.source();
          renderer = new HtmlReportRenderer(new ChartJsRenderer(script), home);
        }
        const text = renderer.render(report);

        const toFile = flags.out !== undefined || flags.open === true || format === 'html';
        if (!toFile) {
          ctx.print(text.trimEnd());
          return;
        }
        const path = flags.out
          ? resolve(flags.out)
          : join(ctx.container.paths.home, 'reports', `report-${localDay(now)}.${format}`);
        await ctx.container.fileWriter.write(path, text);
        ctx.print(`Report written to ${path}`);
        if (flags.open) await ctx.container.opener.open(path);
      });
  }
}

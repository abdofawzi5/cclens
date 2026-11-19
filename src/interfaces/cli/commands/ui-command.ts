import type { Command } from 'commander';
import { ChartJsRenderer } from '../../render/report/chartjs-renderer.js';
import { HtmlReportRenderer } from '../../render/report/html-report-renderer.js';
import { LIVE_SCRIPT, liveToolbar, UiServer } from '../../ui/ui-server.js';
import type { CliCommand, CommandContext } from '../command.js';
import { parsePositiveInt } from '../dates.js';

export const DEFAULT_UI_PORT = 4477;

interface UiFlags {
  port?: number;
  days?: number;
  open: boolean;
}

function parsePort(value: string): number {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0 || n > 65_535) throw new Error('port must be 0 to 65535');
  return n;
}

const isAddrInUse = (error: unknown): boolean =>
  typeof error === 'object' &&
  error !== null &&
  (error as { code?: unknown }).code === 'EADDRINUSE';

/** `cclens ui`: the usage report as a live local web page. */
export class UiCommand implements CliCommand {
  register(program: Command, ctx: CommandContext): void {
    program
      .command('ui')
      .description('open the usage report as a live page on http://127.0.0.1 (local only)')
      .option(
        '--port <n>',
        `port to listen on (default ${String(DEFAULT_UI_PORT)}, 0 = any free)`,
        parsePort,
      )
      .option(
        '--days <n>',
        'window to show first (default: config review.windowDays)',
        parsePositiveInt,
      )
      .option('--no-open', 'do not open the browser')
      .action(async (flags: UiFlags) => {
        const c = ctx.container;
        const defaultDays = flags.days ?? (await ctx.services.config.load()).review.windowDays;
        const charts = new ChartJsRenderer(await c.chartScript.source());
        const home = c.paths.claudeHome.replace(/[\\/]\.claude$/, '');
        const server = new UiServer({
          defaultDays,
          build: (days) => ctx.services.report.build({ windowDays: days }),
          render: (report, days, stamp) =>
            new HtmlReportRenderer(charts, home, {
              title: 'cclens',
              toolbar: liveToolbar(days, stamp),
              script: LIVE_SCRIPT,
            }).render(report),
        });

        let url: string;
        try {
          url = await server.listen(flags.port ?? DEFAULT_UI_PORT);
        } catch (error) {
          if (flags.port !== undefined || !isAddrInUse(error)) throw error;
          url = await server.listen(0);
        }
        ctx.print(`cclens ui is running at ${url} (local only). Press Ctrl+C to stop.`);
        // Warm the cache so the first page load is quick.
        void server.entry(defaultDays).catch(() => undefined);
        if (flags.open) await c.opener.open(url).catch(() => undefined);

        await new Promise<void>((resolve) => {
          const stop = (): void => {
            process.off('SIGINT', stop);
            process.off('SIGTERM', stop);
            void server.close().then(resolve);
          };
          process.on('SIGINT', stop);
          process.on('SIGTERM', stop);
        });
      });
  }
}

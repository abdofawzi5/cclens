import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { resolvePaths } from '../../../src/adapters/system/paths.js';
import { createContainer } from '../../../src/composition-root.js';
import type { UsageReport } from '../../../src/core/domain/report.js';
import { buildProgram } from '../../../src/interfaces/cli/program.js';
import { daysSince, reportFormat } from '../../../src/interfaces/cli/commands/report-command.js';
import {
  jsonForScript,
  safeForScript,
  type ChartRenderer,
} from '../../../src/interfaces/render/report/chart-renderer.js';
import { ChartJsRenderer } from '../../../src/interfaces/render/report/chartjs-renderer.js';
import { HtmlReportRenderer } from '../../../src/interfaces/render/report/html-report-renderer.js';
import { MarkdownReportRenderer } from '../../../src/interfaces/render/report/markdown-report-renderer.js';
import { FixedClock, MemoryEventStore } from '../../support/fakes.js';
import { FakeTokens } from '../../support/fake-tokens.js';
import { InMemoryConfigStore } from '../../support/in-memory-config-store.js';
import { activity } from '../../support/review.js';

const htmlReport = join('/tmp/cclens-home', 'reports', 'report-2026-11-19.html');
const EVIL = '</script><img src=x onerror="alert(1)"> | pipe';

const report: UsageReport = {
  generatedAt: new Date(2026, 10, 19, 12),
  since: new Date(2026, 10, 18),
  until: new Date(2026, 10, 19, 12),
  windowDays: 2,
  summary: {
    totalTokens: 1_500_000,
    costUsd: 12.345,
    sessions: 1,
    prompts: 4,
    autoCompactions: 1,
    installedSkills: 3,
    usedSkills: 1,
  },
  daily: [
    {
      day: '2026-11-18',
      counts: { input: 0, output: 0, cacheCreation: 0, cacheRead: 0 },
      tokens: 0,
      costUsd: 0,
    },
    {
      day: '2026-11-19',
      counts: { input: 1_500_000, output: 0, cacheCreation: 0, cacheRead: 0 },
      tokens: 1_500_000,
      costUsd: 12.345,
    },
  ],
  models: [
    { model: 'claude-opus-5-5', tokens: 1_000_000, costUsd: 10 },
    { model: 'claude-haiku-5-5', tokens: 500_000, costUsd: 2.345 },
  ],
  topSessions: [
    {
      sessionId: 'aaaa1111-0000',
      label: `${EVIL} (aaaa1111)`,
      title: { text: EVIL, source: 'first-prompt' },
      project: '-Users-me-Workspace-site',
      lastActivity: new Date(2026, 10, 19, 11),
      tokens: 1_500_000,
      costUsd: 12.345,
      prompts: 4,
      autoCompactions: 1,
    },
  ],
  unusedSkills: [{ name: 'mkt', isPlugin: true, skills: 2, listingTokens: 900 }],
  unusedListingTokens: 900,
  findings: [
    {
      ruleId: 'long-sessions',
      severity: 'warn',
      title: 'Long session',
      detail: 'Split <work>.',
      estimatedTokenSavings: 5000,
      savingsBasis: 'window',
      actions: ['/compact'],
    },
  ],
  notes: ['Could not load daily tokens'],
};

const fakeCharts: ChartRenderer = {
  head: () => '<script>/* lib */</script>',
  placeholder: (s) => `<canvas id="${s.id}"></canvas>`,
  script: (specs) => `<script>/* ${specs.map((s) => s.id).join(',')} */</script>`,
};

describe('report format and window', () => {
  it('picks the format from --format, the file extension, or --open', () => {
    expect(reportFormat({})).toBe('md');
    expect(reportFormat({ open: true })).toBe('html');
    expect(reportFormat({ out: 'a.json' })).toBe('json');
    expect(reportFormat({ out: 'a.HTML' })).toBe('html');
    expect(reportFormat({ out: 'a.md', open: true })).toBe('md');
    expect(reportFormat({ out: 'report' })).toBe('html');
    expect(reportFormat({ format: 'json', out: 'a.html' })).toBe('json');
  });

  it('counts days since a date, inclusive', () => {
    const now = new Date(2026, 10, 19, 15);
    expect(daysSince(new Date(2026, 10, 19), now)).toBe(1);
    expect(daysSince(new Date(2026, 10, 1), now)).toBe(19);
    expect(daysSince(new Date(2026, 11, 1), now)).toBe(1);
  });
});

describe('script embedding', () => {
  it('keeps inlined code and JSON from closing the script element', () => {
    expect(safeForScript('a="</script>";<!--')).toBe('a="<\\/script>";<\\!--');
    const json = jsonForScript({ t: '</script>\u2028' });
    expect(json).not.toContain('<');
    expect(JSON.parse(json)).toEqual({ t: '</script>\u2028' });
  });
});

describe('HtmlReportRenderer', () => {
  const html = new HtmlReportRenderer(fakeCharts, '/Users/me').render(report);

  it('escapes user text such as session titles', () => {
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;/script&gt;&lt;img src=x onerror=&quot;alert(1)&quot;&gt;');
    expect(html).toContain('Split &lt;work&gt;.');
  });

  it('has KPIs, tables and one chart per series', () => {
    expect(html).toContain('$12.35');
    expect(html).toContain('1.5M');
    expect(html).toContain('<td>Workspace-site</td>');
    expect(html).toContain('/* daily-cost,daily-tokens,models,sessions,unused */');
    expect(html).toContain('Could not load daily tokens');
    expect(html).toContain('prefers-color-scheme: dark');
  });

  it('loads nothing from the network', () => {
    expect(html).not.toMatch(/<script[^>]+src=/i);
    expect(html).not.toMatch(/<link[^>]+href=/i);
    expect(html).not.toMatch(/@import|url\(/i);
  });

  it('skips the model chart when there is one model, and charts with Chart.js', () => {
    const one = { ...report, models: report.models.slice(0, 1) };
    const out = new HtmlReportRenderer(new ChartJsRenderer('/*lib*/'), '/Users/me').render(one);
    expect(out).not.toContain('id="models"');
    expect(out).toContain('<canvas id="sessions" role="img"');
    expect(out).toContain('<script>/*lib*/</script>');
    // The chart data carries the title, escaped for a script context.
    expect(out).toContain('\\u003c/script>\\u003cimg');
    expect(out).not.toMatch(/"labels":\["<\/script>/);
  });
});

describe('MarkdownReportRenderer', () => {
  const md = new MarkdownReportRenderer('/Users/me').render(report);

  it('renders tables and findings, escaping pipes in titles', () => {
    expect(md).toContain('# cclens report: 2026-11-18 to 2026-11-19');
    expect(md).toContain('| $12.35 | 1.5M | 1 | 4 | 1 | 1 of 3 |');
    expect(md).toContain('| 2026-11-19 | 1.5M | $12.35 |');
    expect(md).not.toContain('| 2026-11-18 |');
    expect(md).toContain('\\| pipe (aaaa1111) | Workspace-site |');
    expect(md).toContain('### [warn] Long session (saves ~5.0K tokens)');
    expect(md).toContain('- `/compact`');
    expect(md).toContain('2 unused skills add about 900 listing tokens.');
  });

  it('says so when there are no findings', () => {
    const out = new MarkdownReportRenderer().render({ ...report, findings: [], notes: [] });
    expect(out).toContain('No findings: nothing to optimize right now.');
    expect(out).not.toContain('## Notes');
  });
});

describe('report command', () => {
  async function run(args: string[]) {
    const written: { path: string; data: string }[] = [];
    const opened: string[] = [];
    const container = createContainer({
      overrides: {
        paths: resolvePaths({ CCLENS_HOME: '/tmp/cclens-home' }, '/Users/me'),
        clock: new FixedClock(new Date(2026, 10, 19, 12)),
        configStore: new InMemoryConfigStore(),
        eventStore: new MemoryEventStore(),
        tokens: new FakeTokens(),
        skillSource: { id: 'fake', list: () => Promise.resolve([]) },
        activitySource: {
          read: () =>
            Promise.resolve([
              activity('expensive', { title: { text: 'Big refactor', source: 'custom' } }),
            ]),
        },
        fileWriter: {
          write: (path, data) => {
            written.push({ path, data });
            return Promise.resolve();
          },
        },
        opener: {
          open: (target) => {
            opened.push(target);
            return Promise.resolve();
          },
        },
        chartScript: { name: 'fake', license: 'MIT', source: () => Promise.resolve('/*lib*/') },
      },
    });
    const lines: string[] = [];
    await buildProgram(container, '1.0.0', (t) => lines.push(t))
      .exitOverride()
      .parseAsync(['node', 'cclens', ...args]);
    return { out: lines.join('\n'), written, opened };
  }

  it('prints Markdown by default', async () => {
    const { out, written } = await run(['report', '--days', '7']);
    expect(out).toContain('# cclens report:');
    expect(out).toContain('## Costliest sessions');
    expect(out).toContain('Big refactor (expensiv)');
    expect(written).toEqual([]);
  });

  it('prints the model with --json', async () => {
    const { out } = await run(['--json', 'report', '--since', '2026-11-13']);
    const model = JSON.parse(out) as { windowDays: number; daily: unknown[] };
    expect(model.windowDays).toBe(7);
    expect(model.daily).toHaveLength(7);
  });

  it('writes HTML to ~/.cclens/reports and opens it', async () => {
    const { out, written, opened } = await run(['report', '--open']);
    expect(written).toHaveLength(1);
    expect(written[0]?.path).toBe(htmlReport);
    expect(written[0]?.data).toContain('<script>/*lib*/</script>');
    expect(opened).toEqual([htmlReport]);
    expect(out).toBe(`Report written to ${htmlReport}`);
  });

  it('writes Markdown to --out without opening it', async () => {
    const { written, opened } = await run(['report', '--out', '/tmp/r.md']);
    expect(written[0]?.path).toBe(resolve('/tmp/r.md'));
    expect(written[0]?.data).toContain('# cclens report:');
    expect(opened).toEqual([]);
  });

  it('rejects an unknown format', async () => {
    await expect(run(['report', '--format', 'pdf'])).rejects.toThrow();
  });
});

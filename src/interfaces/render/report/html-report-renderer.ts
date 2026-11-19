import type { UsageReport } from '../../../core/domain/report.js';
import { localDay } from '../../../core/util/format.js';
import { compact, shortProject, truncate, usd } from '../format.js';
import type { Renderer } from '../renderer.js';
import { type ChartRenderer, type ChartSpec, safeForScript } from './chart-renderer.js';
import { escapeHtml as h } from './html.js';

const TOP_CHART_ROWS = 10;

/**
 * `cclens report --format html`: one self-contained page. All CSS and scripts are
 * inline and the chart library is embedded, so the file opens offline and makes
 * no network requests. Every chart has a table with the same numbers.
 */
/** Extra markup for the live dashboard (`cclens ui`); the saved file has none. */
export interface HtmlPageExtras {
  /** HTML placed under the header line, e.g. window links. Must be escaped by the caller. */
  readonly toolbar?: string;
  /** Inline script appended to the page. */
  readonly script?: string;
  readonly title?: string;
}

export class HtmlReportRenderer implements Renderer {
  constructor(
    private readonly charts: ChartRenderer,
    private readonly home?: string,
    private readonly extras: HtmlPageExtras = {},
  ) {}

  render(data: unknown): string {
    const r = data as UsageReport;
    const specs: ChartSpec[] = [];
    const chart = (spec: ChartSpec): string => {
      specs.push(spec);
      return this.charts.placeholder(spec);
    };
    const s = r.summary;
    const range = `${localDay(r.since)} to ${localDay(r.until)}`;

    const sections: string[] = [];

    sections.push(`<section class="kpis">
${kpi('Estimated cost', usd(s.costUsd))}
${kpi('Tokens', compact(s.totalTokens))}
${kpi('Sessions', String(s.sessions))}
${kpi('Prompts', String(s.prompts))}
${kpi('Auto-compactions', String(s.autoCompactions))}
${kpi('Skills used', `${s.usedSkills} of ${s.installedSkills}`)}
</section>
<p class="muted">Cost is an estimate at API list prices, not your plan’s billing.</p>`);

    const dayLabels = r.daily.map((d) => d.day.slice(5));
    sections.push(`<section>
<h2>Daily cost</h2>
${chart({ id: 'daily-cost', kind: 'bar', title: 'Estimated cost per day', labels: dayLabels, values: r.daily.map((d) => round2(d.costUsd)), unit: 'usd' })}
<h2>Daily tokens</h2>
${chart({ id: 'daily-tokens', kind: 'bar', title: 'Tokens per day', labels: dayLabels, values: r.daily.map((d) => d.tokens), unit: 'tokens' })}
<details><summary>Daily table</summary>
${table(
  ['Day', 'Tokens', 'Cost'],
  r.daily.filter((d) => d.tokens > 0).map((d) => [d.day, compact(d.tokens), usd(d.costUsd)]),
  [false, true, true],
)}
</details>
</section>`);

    if (r.models.length > 0) {
      sections.push(`<section>
<h2>Cost by model</h2>
${r.models.length < 2 ? '' : chart({ id: 'models', kind: 'hbar', title: 'Estimated cost by model', labels: r.models.map((m) => m.model), values: r.models.map((m) => round2(m.costUsd)), unit: 'usd' })}
${table(
  ['Model', 'Tokens', 'Cost'],
  r.models.map((m) => [m.model, compact(m.tokens), usd(m.costUsd)]),
  [false, true, true],
)}
</section>`);
    }

    if (r.topSessions.length > 0) {
      const top = r.topSessions.slice(0, TOP_CHART_ROWS);
      sections.push(`<section>
<h2>Costliest sessions</h2>
${chart({ id: 'sessions', kind: 'hbar', title: 'Estimated cost of the costliest sessions', labels: top.map((t) => truncate(t.label, 80)), values: top.map((t) => round2(t.costUsd)), unit: 'usd' })}
${table(
  ['Session', 'Project', 'Last active', 'Tokens', 'Cost', 'Prompts', 'Compactions'],
  r.topSessions.map((t) => [
    t.label,
    shortProject(t.project, this.home),
    localDay(t.lastActivity),
    compact(t.tokens),
    usd(t.costUsd),
    String(t.prompts),
    String(t.autoCompactions),
  ]),
  [false, false, false, true, true, true, true],
)}
</section>`);
    }

    if (r.unusedSkills.length > 0) {
      const top = r.unusedSkills.slice(0, TOP_CHART_ROWS);
      const count = r.unusedSkills.reduce((n, g) => n + g.skills, 0);
      sections.push(`<section>
<h2>Unused skills</h2>
<p>${count} unused skills add about ${compact(r.unusedListingTokens)} listing tokens. The largest:</p>
${chart({ id: 'unused', kind: 'hbar', title: 'Listing tokens of unused plugins and skills', labels: top.map((g) => g.name), values: top.map((g) => g.listingTokens), unit: 'tokens' })}
<details><summary>All ${r.unusedSkills.length} unused plugins and skills</summary>
${table(
  ['Plugin or skill', 'Skills', 'Listing tokens'],
  r.unusedSkills.map((g) => [g.name, String(g.skills), `~${compact(g.listingTokens)}`]),
  [false, true, true],
)}
</details>
</section>`);
    }

    const findings =
      r.findings.length === 0
        ? '<p>No findings: nothing to optimize right now.</p>'
        : r.findings
            .map((f) => {
              const saving = f.estimatedTokenSavings
                ? `<span class="muted"> · saves ~${compact(f.estimatedTokenSavings)} tokens${f.savingsBasis === 'per-request' ? ' per request' : ''}</span>`
                : '';
              const actions =
                f.actions.length > 0
                  ? `<ul>${f.actions.map((a) => `<li><code>${h(a)}</code></li>`).join('')}</ul>`
                  : '';
              return `<article class="finding"><h3><span class="sev sev-${f.severity}">${h(f.severity)}</span> ${h(f.title)}${saving}</h3><p>${h(f.detail)}</p>${actions}</article>`;
            })
            .join('\n');
    sections.push(`<section><h2>Findings</h2>\n${findings}\n</section>`);

    if (r.notes.length > 0) {
      sections.push(
        `<section><h2>Notes</h2><ul>${r.notes.map((n) => `<li>${h(n)}</li>`).join('')}</ul></section>`,
      );
    }

    return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${h(this.extras.title ?? 'cclens report')} ${h(range)}</title>
<style>${STYLE}</style>
${this.charts.head()}
</head>
<body>
<main>
<header><h1>${h(this.extras.title ?? 'cclens report')}</h1><p class="muted">${h(range)} · ${r.windowDays} days · generated ${h(r.generatedAt.toLocaleString())}</p>${this.extras.toolbar ?? ''}</header>
${sections.join('\n')}
<footer class="muted">Made by cclens from local Claude Code data. Charts by Chart.js (MIT license).</footer>
</main>
${this.charts.script(specs)}
${this.extras.script ? `<script>${safeForScript(this.extras.script)}</script>` : ''}
</body>
</html>
`;
  }
}

function kpi(label: string, value: string): string {
  return `<div class="kpi"><div class="kpi-label">${h(label)}</div><div class="kpi-value">${h(value)}</div></div>`;
}

function table(
  head: readonly string[],
  rows: readonly (readonly string[])[],
  numeric: readonly boolean[],
): string {
  const cls = (i: number): string => (numeric[i] ? ' class="num"' : '');
  return `<div class="table-wrap"><table><thead><tr>${head.map((c, i) => `<th${cls(i)}>${h(c)}</th>`).join('')}</tr></thead><tbody>${rows
    .map((row) => `<tr>${row.map((c, i) => `<td${cls(i)}>${h(c)}</td>`).join('')}</tr>`)
    .join('')}</tbody></table></div>`;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

const STYLE = `
:root {
  color-scheme: light;
  --surface-0: #f4f4f2; --surface-1: #fcfcfb; --border: #e2e1dc;
  --text-primary: #0b0b0b; --text-secondary: #52514e; --text-muted: #6d6c66;
  --grid: #ecebe7; --axis: #c9c8c1;
  --series-1: #2a78d6; --series-1-hover: #1f63b5;
  --warn: #9a6200; --high: #b42318;
  --font: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
}
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    color-scheme: dark;
    --surface-0: #121211; --surface-1: #1a1a19; --border: #2e2e2c;
    --text-primary: #f0efec; --text-secondary: #c3c2b7; --text-muted: #9a998f;
    --grid: #262624; --axis: #3d3d3a;
    --series-1: #3987e5; --series-1-hover: #6aa5ee;
    --warn: #e0a83a; --high: #f07a6e;
  }
}
:root[data-theme="dark"] {
  color-scheme: dark;
  --surface-0: #121211; --surface-1: #1a1a19; --border: #2e2e2c;
  --text-primary: #f0efec; --text-secondary: #c3c2b7; --text-muted: #9a998f;
  --grid: #262624; --axis: #3d3d3a;
  --series-1: #3987e5; --series-1-hover: #6aa5ee;
  --warn: #e0a83a; --high: #f07a6e;
}
* { box-sizing: border-box; }
body { margin: 0; background: var(--surface-0); color: var(--text-primary); font: 15px/1.5 var(--font); }
main { max-width: 1000px; margin: 0 auto; padding: 24px 16px 48px; }
h1 { font-size: 26px; margin: 0; }
h2 { font-size: 17px; margin: 28px 0 8px; }
h3 { font-size: 15px; margin: 0 0 4px; }
section { background: var(--surface-1); border: 1px solid var(--border); border-radius: 10px; padding: 4px 20px 16px; margin-top: 16px; }
section.kpis { display: grid; grid-template-columns: repeat(auto-fit, minmax(120px, 1fr)); gap: 12px; padding: 16px 20px; }
.kpi-label { color: var(--text-secondary); font-size: 13px; }
.kpi-value { font-size: 24px; font-weight: 600; font-variant-numeric: tabular-nums; }
.muted { color: var(--text-muted); font-size: 13px; }
.chart { position: relative; width: 100%; }
.table-wrap { overflow-x: auto; }
table { border-collapse: collapse; width: 100%; margin-top: 12px; font-size: 14px; }
th, td { text-align: left; padding: 6px 8px; border-bottom: 1px solid var(--border); }
th { color: var(--text-secondary); font-weight: 600; }
td.num, th.num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
details { margin-top: 12px; }
summary { cursor: pointer; color: var(--text-secondary); }
.finding { border-top: 1px solid var(--border); padding: 12px 0; }
.finding:first-of-type { border-top: 0; }
.finding p { margin: 4px 0; color: var(--text-secondary); }
.sev { display: inline-block; font-size: 12px; font-weight: 600; text-transform: uppercase; border: 1px solid currentColor; border-radius: 4px; padding: 0 5px; margin-right: 4px; color: var(--text-secondary); }
.sev-warn { color: var(--warn); }
.sev-high { color: var(--high); }
code { font-size: 13px; overflow-wrap: anywhere; }
footer { margin-top: 24px; }
.toolbar { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; margin-top: 10px; font-size: 13px; }
.toolbar a { color: var(--text-secondary); text-decoration: none; border: 1px solid var(--border); border-radius: 999px; padding: 2px 10px; }
.toolbar a:hover { border-color: var(--series-1); }
.toolbar a[aria-current="page"] { background: var(--series-1); border-color: var(--series-1); color: #fff; }
.toolbar .status { margin-left: auto; color: var(--text-muted); }
`;

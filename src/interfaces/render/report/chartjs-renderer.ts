import { escapeHtml } from './html.js';
import {
  type ChartRenderer,
  type ChartSpec,
  jsonForScript,
  safeForScript,
} from './chart-renderer.js';

/**
 * `ChartRenderer` on Chart.js (MIT). The library is inlined, so the file opens
 * offline. Colors come from the page's CSS variables, so charts follow dark mode.
 */
export class ChartJsRenderer implements ChartRenderer {
  constructor(private readonly librarySource: string) {}

  head(): string {
    return `<script>${safeForScript(this.librarySource)}</script>`;
  }

  placeholder(spec: ChartSpec): string {
    const height = spec.kind === 'hbar' ? Math.max(160, 28 * spec.labels.length + 40) : 260;
    return `<div class="chart" style="height:${height}px"><canvas id="${escapeHtml(spec.id)}" role="img" aria-label="${escapeHtml(spec.title)}"></canvas></div>`;
  }

  script(specs: readonly ChartSpec[]): string {
    return `<script>
(function () {
  if (typeof Chart === 'undefined') return;
  var specs = ${jsonForScript(specs)};
  var css = getComputedStyle(document.documentElement);
  var v = function (name) { return css.getPropertyValue(name).trim(); };
  var fmt = function (unit, n) {
    if (unit === 'usd') return '$' + n.toFixed(2);
    var a = Math.abs(n);
    if (a >= 1e9) return (n / 1e9).toFixed(1) + 'B';
    if (a >= 1e6) return (n / 1e6).toFixed(1) + 'M';
    if (a >= 1e3) return (n / 1e3).toFixed(1) + 'K';
    return String(Math.round(n));
  };
  Chart.defaults.color = v('--text-secondary');
  Chart.defaults.borderColor = v('--grid');
  Chart.defaults.font.family = v('--font');
  specs.forEach(function (s) {
    var el = document.getElementById(s.id);
    if (!el) return;
    var horizontal = s.kind === 'hbar';
    var valueAxis = {
      beginAtZero: true,
      grid: { color: v('--grid') },
      border: { display: false },
      ticks: { callback: function (n) { return fmt(s.unit, Number(n)); }, maxTicksLimit: 6 }
    };
    // Long names (session titles) are shortened on the axis; the tooltip shows them in full.
    var maxLabel = el.parentNode.clientWidth < 560 ? 18 : 36;
    var labelAxis = {
      grid: { display: false },
      border: { color: v('--axis') },
      ticks: horizontal
        ? { autoSkip: false, callback: function (i) {
            var l = String(this.getLabelForValue(i));
            return l.length > maxLabel ? l.slice(0, maxLabel - 1) + '\u2026' : l;
          } }
        : { maxRotation: 0, autoSkipPadding: 12 }
    };
    new Chart(el, {
      type: 'bar',
      data: {
        labels: s.labels,
        datasets: [{
          label: s.title,
          data: s.values,
          backgroundColor: v('--series-1'),
          hoverBackgroundColor: v('--series-1-hover'),
          borderRadius: 4,
          borderSkipped: 'start',
          maxBarThickness: horizontal ? 18 : 24,
          categoryPercentage: 0.85,
          barPercentage: 0.9
        }]
      },
      options: {
        indexAxis: horizontal ? 'y' : 'x',
        maintainAspectRatio: false,
        animation: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { display: false },
          tooltip: { callbacks: { label: function (c) { return ' ' + fmt(s.unit, Number(c.raw)); } } }
        },
        scales: horizontal ? { x: valueAxis, y: labelAxis } : { x: labelAxis, y: valueAxis }
      }
    });
  });
})();
</script>`;
  }
}

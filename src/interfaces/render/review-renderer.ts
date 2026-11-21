import { homedir } from 'node:os';
import { stripVTControlCharacters as strip } from 'node:util';
import pc from 'picocolors';
import type { RuleInfo } from '../../app/review-service.js';
import type { Recommendation, Severity } from '../../core/domain/recommendation.js';
import type { ReviewReport } from '../../core/domain/review.js';
import { SessionLabels } from '../../core/domain/session-labels.js';
import {
  change,
  costPerPrompt,
  type WindowComparison,
  type WindowStats,
} from '../../core/domain/trend.js';
import { localDay, percent } from '../../core/util/format.js';
import { compact, shortProject, usd } from './format.js';
import type { Renderer } from './renderer.js';

const BADGE: Record<Severity, string> = {
  high: pc.red(pc.bold('HIGH')),
  warn: pc.yellow(pc.bold('WARN')),
  info: pc.cyan(pc.bold('INFO')),
};

/** Wraps text at word boundaries to `width` columns, prefixing each line with `indent`. */
export function wrap(text: string, width: number, indent: string): string[] {
  const lines: string[] = [];
  let line = '';
  for (const word of text.split(/\s+/).filter(Boolean)) {
    if (line && line.length + 1 + word.length > width - indent.length) {
      lines.push(indent + line);
      line = word;
    } else {
      line = line ? `${line} ${word}` : word;
    }
  }
  if (line) lines.push(indent + line);
  return lines;
}

function savings(r: Recommendation): string {
  if (!r.estimatedTokenSavings) return '';
  const n = compact(r.estimatedTokenSavings);
  return pc.green(
    r.savingsBasis === 'per-request'
      ? `saves up to ~${n} tokens per request`
      : `saves ~${n} tokens over the period`,
  );
}

type Better = 'lower' | 'higher' | 'neither';

interface Metric {
  readonly label: string;
  readonly value: (s: WindowStats) => number | undefined;
  readonly show: (n: number) => string;
  readonly better: Better;
  /** Show the change in percentage points instead of percent. */
  readonly points?: boolean;
}

const METRICS: readonly Metric[] = [
  { label: 'Estimated cost', value: (s) => s.costUsd, show: usd, better: 'lower' },
  { label: 'Tokens', value: (s) => s.totalTokens, show: compact, better: 'lower' },
  { label: 'Sessions', value: (s) => s.sessions, show: String, better: 'neither' },
  { label: 'Prompts', value: (s) => s.prompts, show: String, better: 'neither' },
  { label: 'Cost per prompt', value: costPerPrompt, show: usd, better: 'lower' },
  { label: 'Auto-compactions', value: (s) => s.autoCompactions, show: String, better: 'lower' },
  {
    label: 'Cache reads',
    value: (s) => s.cacheReadShare,
    show: percent,
    better: 'higher',
    points: true,
  },
];

function delta(m: Metric, before: number | undefined, after: number | undefined): string {
  if (before === undefined || after === undefined) return '';
  let text: string;
  let diff: number;
  if (m.points) {
    diff = Math.round((after - before) * 100);
    text = `${diff > 0 ? '+' : ''}${String(diff)} pts`;
  } else {
    const c = change(before, after);
    if (c === undefined) return after === 0 ? '' : 'new';
    diff = Math.round(c * 100);
    text = `${diff > 0 ? '+' : ''}${String(diff)}%`;
  }
  if (diff === 0 || m.better === 'neither') return pc.dim(text);
  const good = m.better === 'lower' ? diff < 0 : diff > 0;
  return good ? pc.green(text) : pc.yellow(text);
}

/** `--compare`: this window against the one before it. */
export function renderComparison(c: WindowComparison): string[] {
  const prevEnd = new Date(c.previous.until.getTime() - 1);
  const rows = METRICS.map((m) => {
    const before = m.value(c.previous);
    const after = m.value(c.current);
    return [
      m.label,
      before === undefined ? '–' : m.show(before),
      after === undefined ? '–' : m.show(after),
      delta(m, before, after),
    ];
  });
  const head = ['', 'Before', 'Now', 'Change'];
  const widths = head.map((h, i) =>
    Math.max(h.length, ...rows.map((r) => strip(r[i] ?? '').length)),
  );
  const line = (r: readonly string[]): string =>
    r
      .map((cell, i) =>
        i === 0
          ? cell.padEnd(widths[i] ?? 0)
          : ' '.repeat(Math.max(0, (widths[i] ?? 0) - strip(cell).length)) + cell,
      )
      .join('  ');
  return [
    pc.bold(`Compared with ${localDay(c.previous.since)} to ${localDay(prevEnd)}`),
    pc.dim(line(head)),
    ...rows.map(line),
    '',
  ];
}

/** `cclens review` as readable text: summary line, then each finding with its actions. */
export class ReviewRenderer implements Renderer {
  constructor(private readonly width = 88) {}

  render(data: unknown): string {
    const r = data as ReviewReport;
    const s = r.summary;
    const heading =
      r.scope.kind === 'session'
        ? `Review of session ${r.scope.title ? SessionLabels.from([r.scope]).label(r.scope.sessionId) : r.scope.sessionId}`
        : `Review of ${r.project ? `${shortProject(r.project, homedir())}, ` : ''}${localDay(r.since)} to ${localDay(r.until)}`;
    const facts = [
      `${compact(s.totalTokens)} tokens`,
      `${usd(s.costUsd)} est.`,
      `${s.sessions} ${s.sessions === 1 ? 'session' : 'sessions'}`,
      `${s.prompts} prompts`,
      `${s.autoCompactions} ${s.autoCompactions === 1 ? 'auto-compaction' : 'auto-compactions'}`,
    ];
    if (r.scope.kind === 'window') {
      facts.push(`${s.usedSkills} of ${s.installedSkills} skills used`);
    }
    const out = [pc.bold(heading), pc.dim(facts.join(' · ')), ''];
    if (r.comparison) out.push(...renderComparison(r.comparison));

    if (r.recommendations.length === 0) {
      out.push(pc.green('Nothing to improve: no rule found a problem.'), '');
    }
    for (const rec of r.recommendations) {
      const tag = rec.ruleId === 'ai' ? pc.magenta(' (AI)') : '';
      out.push(`${BADGE[rec.severity]}${tag} ${pc.bold(rec.title)}`);
      const save = savings(rec);
      if (save) out.push(`     ${save}`);
      out.push(...wrap(rec.detail, this.width, '     '));
      for (const action of rec.actions) out.push(`     ${pc.cyan('→')} ${action}`);
      out.push('');
    }

    const footer = [`${r.rulesRun.length} rules checked`];
    if (r.ai) {
      footer.push(
        r.ai.ok
          ? `AI review added ${r.ai.count} ${r.ai.count === 1 ? 'suggestion' : 'suggestions'}`
          : pc.yellow(`AI review failed: ${r.ai.error}`),
      );
    } else {
      footer.push('add --ai for a second opinion from Claude');
    }
    out.push(pc.dim(footer.join(' · ')));
    for (const note of r.notes) out.push(pc.yellow(`! ${note}`));
    return out.join('\n');
  }
}

export class RuleListRenderer implements Renderer {
  render(data: unknown): string {
    const rules = data as readonly RuleInfo[];
    return rules
      .map((r) => {
        const state = r.enabled ? pc.green('on ') : pc.dim('off');
        return `${state} ${pc.bold(r.id.padEnd(20))} ${r.description} ${pc.dim(`[${r.appliesTo.join(', ')}]`)}`;
      })
      .join('\n');
  }
}

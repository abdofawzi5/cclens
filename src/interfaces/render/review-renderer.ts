import pc from 'picocolors';
import type { RuleInfo } from '../../app/review-service.js';
import type { Recommendation, Severity } from '../../core/domain/recommendation.js';
import type { ReviewReport } from '../../core/domain/review.js';
import { SessionLabels } from '../../core/domain/session-labels.js';
import { localDay } from '../../core/util/format.js';
import { compact, usd } from './format.js';
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

/** `cclens review` as readable text: summary line, then each finding with its actions. */
export class ReviewRenderer implements Renderer {
  constructor(private readonly width = 88) {}

  render(data: unknown): string {
    const r = data as ReviewReport;
    const s = r.summary;
    const heading =
      r.scope.kind === 'session'
        ? `Review of session ${r.scope.title ? SessionLabels.from([r.scope]).label(r.scope.sessionId) : r.scope.sessionId}`
        : `Review of ${localDay(r.since)} to ${localDay(r.until)}`;
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

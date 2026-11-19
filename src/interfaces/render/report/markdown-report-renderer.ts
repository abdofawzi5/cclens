import type { UsageReport } from '../../../core/domain/report.js';
import { localDay } from '../../../core/util/format.js';
import { compact, shortProject, usd } from '../format.js';
import type { Renderer } from '../renderer.js';

/** `cclens report --format md`: the report as GitHub-flavoured Markdown. */
export class MarkdownReportRenderer implements Renderer {
  constructor(private readonly home?: string) {}

  render(data: unknown): string {
    const r = data as UsageReport;
    const s = r.summary;
    const out: string[] = [
      `# cclens report: ${localDay(r.since)} to ${localDay(r.until)}`,
      '',
      `${r.windowDays} days · generated ${r.generatedAt.toLocaleString()}`,
      '',
      '| Cost | Tokens | Sessions | Prompts | Auto-compactions | Skills used |',
      '| ---: | ---: | ---: | ---: | ---: | ---: |',
      `| ${usd(s.costUsd)} | ${compact(s.totalTokens)} | ${s.sessions} | ${s.prompts} | ${s.autoCompactions} | ${s.usedSkills} of ${s.installedSkills} |`,
      '',
      '_Cost is an estimate at API list prices, not your plan’s billing._',
    ];

    const used = r.daily.filter((d) => d.tokens > 0);
    if (used.length > 0) {
      out.push('', '## Daily use', '', '| Day | Tokens | Cost |', '| --- | ---: | ---: |');
      for (const d of used) out.push(`| ${d.day} | ${compact(d.tokens)} | ${usd(d.costUsd)} |`);
    }

    if (r.models.length > 0) {
      out.push('', '## By model', '', '| Model | Tokens | Cost |', '| --- | ---: | ---: |');
      for (const m of r.models) {
        out.push(`| ${cell(m.model)} | ${compact(m.tokens)} | ${usd(m.costUsd)} |`);
      }
    }

    if (r.topSessions.length > 0) {
      out.push(
        '',
        '## Costliest sessions',
        '',
        '| Session | Project | Tokens | Cost | Prompts | Compactions |',
        '| --- | --- | ---: | ---: | ---: | ---: |',
      );
      for (const t of r.topSessions) {
        out.push(
          `| ${cell(t.label)} | ${cell(shortProject(t.project, this.home))} | ${compact(t.tokens)} | ${usd(t.costUsd)} | ${t.prompts} | ${t.autoCompactions} |`,
        );
      }
    }

    if (r.unusedSkills.length > 0) {
      out.push(
        '',
        '## Unused skills',
        '',
        `${r.unusedSkills.reduce((n, g) => n + g.skills, 0)} unused skills add about ${compact(r.unusedListingTokens)} listing tokens.`,
        '',
        '| Plugin or skill | Skills | Listing tokens |',
        '| --- | ---: | ---: |',
      );
      for (const g of r.unusedSkills) {
        out.push(`| ${cell(g.name)} | ${g.skills} | ~${compact(g.listingTokens)} |`);
      }
    }

    out.push('', '## Findings', '');
    if (r.findings.length === 0) out.push('No findings: nothing to optimize right now.');
    for (const f of r.findings) {
      const saving = f.estimatedTokenSavings
        ? ` (saves ~${compact(f.estimatedTokenSavings)} tokens${f.savingsBasis === 'per-request' ? ' per request' : ''})`
        : '';
      out.push(`### [${f.severity}] ${f.title}${saving}`, '', f.detail, '');
      for (const a of f.actions) out.push(`- \`${a.replace(/`/g, "'")}\``);
      if (f.actions.length > 0) out.push('');
    }

    if (r.notes.length > 0) {
      out.push('', '## Notes', '');
      for (const n of r.notes) out.push(`- ${n}`);
    }
    return `${out.join('\n').trimEnd()}\n`;
  }
}

/** Keeps user text (session titles come from prompts) from breaking the table. */
function cell(text: string): string {
  return text.replace(/\|/g, '\\|').replace(/[\r\n]+/g, ' ');
}

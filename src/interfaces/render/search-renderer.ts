import pc from 'picocolors';
import type { EngineOutcome, SearchReport, SearchResult } from '../../core/domain/search.js';
import { compact } from './format.js';
import type { Renderer } from './renderer.js';
import { wrap } from './review-renderer.js';

function headline(r: SearchResult, i: number): string {
  const parts = [`${pc.dim(`${String(i + 1).padStart(2)}.`)} ${pc.bold(r.name)}`];
  if (r.kind === 'repo') parts.push(pc.dim('(repo)'));
  else if (r.repo) parts.push(pc.dim(`${r.repo.owner}/${r.repo.name}`));
  if (r.stars !== undefined) parts.push(pc.yellow(`★ ${compact(r.stars)}`));
  if (r.installs !== undefined) parts.push(pc.cyan(`↓ ${compact(r.installs)}`));
  if (r.installed) parts.push(pc.green('✔ same name installed'));
  if (r.archived) parts.push(pc.red('archived'));
  return parts.join('  ');
}

export function outcomeLine(o: EngineOutcome, unofficial: ReadonlySet<string>): string {
  const label = unofficial.has(o.engineId) ? `${o.engineId} (unofficial)` : o.engineId;
  if (!o.ok) return `${pc.red('✖')} ${label}: ${o.error}`;
  const how = o.cached ? 'cached' : `${o.ms} ms`;
  return `${pc.green('✔')} ${label}: ${o.count} results, ${how}`;
}

/** Search results as a numbered list with stars, installs, source engines and link. */
export class SearchRenderer implements Renderer {
  constructor(
    private readonly unofficial: ReadonlySet<string> = new Set(),
    private readonly width = 88,
  ) {}

  render(data: unknown): string {
    const report = data as SearchReport;
    const out: string[] = [];
    if (report.results.length === 0) {
      out.push(pc.dim(`No skills found for "${report.query.text}".`));
    }
    report.results.forEach((r, i) => {
      out.push(headline(r, i));
      if (r.description) {
        const text = r.description.length > 220 ? `${r.description.slice(0, 219)}…` : r.description;
        out.push(...wrap(text, this.width, '    '));
      }
      out.push(`    ${pc.underline(r.url)}  ${pc.dim(`via ${r.engineIds.join(', ')}`)}`);
      out.push('');
    });
    const sort = `sorted by ${report.query.sort}`;
    const matching = report.totalFound - report.filteredOut;
    const hidden =
      report.filteredOut > 0
        ? ` (${report.filteredOut} more hidden by --min-stars or because they are archived)`
        : '';
    out.push(
      pc.dim(
        `Showing ${report.results.length} of ${matching} after merging duplicates${hidden}, ${sort}.`,
      ),
    );
    for (const o of report.outcomes) out.push(pc.dim(outcomeLine(o, this.unofficial)));
    for (const n of report.notes) out.push(pc.yellow(`! ${n}`));
    return out.join('\n');
  }
}

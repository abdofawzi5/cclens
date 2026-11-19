import pc from 'picocolors';
import type { InstallReport } from '../../app/install/install-runner.js';
import type { CheckResult } from '../../core/ports/install.js';
import type { Renderer } from './renderer.js';

const MARK = {
  done: pc.green('✔'),
  skipped: pc.dim('–'),
  ok: pc.green('✔'),
  warn: pc.yellow('!'),
  fail: pc.red('✖'),
} as const;

export class InstallReportRenderer implements Renderer {
  render(data: unknown): string {
    const report = data as InstallReport;
    const lines = report.steps.map(
      (s) => `${MARK[s.status]} ${pc.bold(s.title)}  ${pc.dim(s.message)}`,
    );
    if (report.ok) {
      lines.push(
        '',
        pc.green('cclens is set up.'),
        'New Claude Code sessions will record skill uses.',
      );
    } else {
      lines.push('', `${MARK.fail} ${report.error ?? 'failed'}`);
      if (report.rolledBack.length > 0)
        lines.push(pc.dim(`Rolled back: ${report.rolledBack.join(', ')}`));
    }
    return lines.join('\n');
  }
}

export class DoctorRenderer implements Renderer {
  render(data: unknown): string {
    const results = data as readonly CheckResult[];
    return results
      .map((r) => {
        const fix = r.fix ? `\n    ${pc.cyan('fix:')} ${r.fix}` : '';
        return `${MARK[r.status]} ${pc.bold(r.title)}  ${r.message}${fix}`;
      })
      .join('\n');
  }
}

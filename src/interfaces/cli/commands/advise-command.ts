import type { Command } from 'commander';
import pc from 'picocolors';
import type { Advice } from '../../../core/domain/advice.js';
import type { FixHint } from '../../../core/domain/fix-hints.js';
import type { Recommendation, Severity } from '../../../core/domain/recommendation.js';
import { compact, localDay, percent, usd } from '../../../core/util/format.js';
import { truncate } from '../../render/format.js';
import type { Renderer } from '../../render/renderer.js';
import { wrap } from '../../render/review-renderer.js';
import type { CliCommand, CommandContext } from '../command.js';
import { parsePositiveInt } from '../dates.js';
import { formatOf } from '../options.js';

interface AdviseFlags {
  days?: number;
  ai?: boolean;
  search: boolean;
  top?: number;
}

const BADGE: Record<Severity, string> = {
  high: pc.red(pc.bold('HIGH')),
  warn: pc.yellow(pc.bold('WARN')),
  info: pc.cyan(pc.bold('INFO')),
};

function saving(r: Recommendation): string {
  if (!r.estimatedTokenSavings) return '';
  const n = compact(r.estimatedTokenSavings);
  return r.savingsBasis === 'per-request'
    ? `saves up to ~${n} tokens per request`
    : `saves ~${n} tokens over the period`;
}

function hintSize(h: FixHint): string {
  const n = h.group.skills;
  return `${String(n)} ${n === 1 ? 'skill' : 'skills'}, ~${compact(h.group.tokens)} tokens`;
}

/** `cclens advise` as text: summary, ranked suggestions, plugins to turn off, skills to try. */
export class AdviceRenderer implements Renderer {
  constructor(
    private readonly top = 8,
    private readonly width = 88,
  ) {}

  render(data: unknown): string {
    const a = data as Advice;
    const s = a.summary;
    const facts = [
      `${compact(s.totalTokens)} tokens`,
      `${usd(s.costUsd)} est.`,
      `${String(s.sessions)} sessions`,
      `${String(s.prompts)} prompts`,
      `${String(s.usedSkills)} of ${String(s.installedSkills)} skills used`,
    ];
    if (a.contextTokens !== undefined) {
      facts.push(`~${compact(a.contextTokens)} tokens before the first prompt`);
    }
    const out = [
      pc.bold(`Advice for ${localDay(a.since)} to ${localDay(a.until)}`),
      pc.dim(facts.join(' · ')),
      '',
    ];

    // 1. Ranked suggestions.
    const shown = a.suggestions.slice(0, this.top);
    out.push(pc.bold(`Top ${String(shown.length)} ways to save tokens`));
    if (shown.length === 0) out.push(pc.green('  Nothing to improve: no check found a problem.'));
    shown.forEach((r, i) => {
      out.push(
        `${pc.dim(`${String(i + 1).padStart(2)}.`)} ${BADGE[r.severity]} ${pc.bold(r.title)}`,
      );
      const save = saving(r);
      if (save) out.push(`      ${pc.green(save)}`);
      out.push(...wrap(r.detail, this.width, '      '));
      for (const action of r.actions) out.push(`      ${pc.cyan('→')} ${action}`);
    });
    if (a.suggestions.length > shown.length) {
      out.push(
        pc.dim(
          `    …and ${String(a.suggestions.length - shown.length)} more (--top <n> or --json)`,
        ),
      );
    }
    out.push('');

    // 2. Plugins and skills to turn off.
    if (a.disable.length > 0) {
      const tokens = a.disable.reduce((n, h) => n + h.group.tokens, 0);
      out.push(
        pc.bold(`Plugins and skills to turn off`) +
          pc.dim(` (unused in this window, ~${compact(tokens)} listing tokens per request)`),
      );
      const commands = a.disable.filter((h) => h.kind === 'command').slice(0, this.top);
      const width = Math.max(0, ...commands.map((h) => h.command.length));
      for (const h of commands) {
        out.push(
          `  ${h.command.padEnd(width)}  ${pc.dim(`# ${hintSize(h)}${h.note ? `; ${h.note}` : ''}`)}`,
        );
      }
      const manual = a.disable.filter((h) => h.kind === 'manual').slice(0, 3);
      for (const h of manual) {
        const name = h.group.plugin ?? h.group.skillId ?? '';
        out.push(`  ${pc.bold(name)} ${pc.dim(`(${hintSize(h)})`)}: ${h.note}`);
      }
      const rest = a.disable.length - commands.length - manual.length;
      if (rest > 0) out.push(pc.dim(`  …and ${String(rest)} more: cclens skills --unused --fix`));
      out.push(
        pc.dim(
          '  Printed only; cclens never runs them. Uses are known only since recording began.',
        ),
        '',
      );
    }

    // 3. Skills that might handle repeated tasks.
    if (a.discover.length > 0) {
      out.push(pc.bold('Skills that might handle your repeated tasks'));
      for (const d of a.discover) {
        const monthly =
          d.job.monthlyCostUsd !== undefined ? `, ~${usd(d.job.monthlyCostUsd)} a month` : '';
        out.push(
          `  ${pc.bold(truncate(d.job.name, 50))} ${pc.dim(`(${d.job.kind}, ${String(d.job.runs.length)} runs${monthly}; searched "${d.query}")`)}`,
        );
        for (const r of d.results) {
          const stars = r.stars !== undefined ? pc.yellow(` ★ ${compact(r.stars)}`) : '';
          const desc = r.description ? pc.dim(` ${truncate(r.description, 70)}`) : '';
          out.push(`    • ${r.name}${stars}${desc}`);
          out.push(`      ${pc.underline(r.url)}`);
        }
      }
      out.push(pc.dim('  Suggestions only: read a skill before installing it.'), '');
    }

    // 4. Budget.
    for (const b of a.budget) {
      const line = `${b.limit} budget: ${usd(b.spentUsd)} of ${usd(b.limitUsd)} (${percent(b.fraction)})`;
      out.push(b.over ? pc.red(line) : pc.dim(line));
    }

    out.push(
      pc.dim(
        'Costs are estimates at API list prices. Run `cclens review --compare` after a change to see if it helped.',
      ),
    );
    for (const note of a.notes) out.push(pc.yellow(`! ${note}`));
    return out.join('\n');
  }
}

/** `cclens advise`: every analysis in one pass, ranked into what to change first. */
export class AdviseCommand implements CliCommand {
  register(program: Command, ctx: CommandContext): void {
    program
      .command('advise')
      .alias('optimize')
      .description(
        'run every analysis and suggest what to change: savings, plugins to turn off, skills to try',
      )
      .option(
        '--days <n>',
        'look back this many days (default: config review.windowDays)',
        parsePositiveInt,
      )
      .option('--ai', 'also ask Claude (claude -p, your login) for suggestions; costs a few tokens')
      .option('--no-search', 'do not search skill registries for your repeated tasks (offline)')
      .option('--top <n>', 'how many suggestions to show (default 8)', parsePositiveInt)
      .action(async (flags: AdviseFlags) => {
        const advice = await ctx.services.advise.advise({
          ...(flags.days ? { windowDays: flags.days } : {}),
          ...(flags.ai ? { ai: true } : {}),
          search: flags.search,
        });
        ctx.print(ctx.renderer(formatOf(program), new AdviceRenderer(flags.top)).render(advice));
      });
  }
}

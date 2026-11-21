import { homedir } from 'node:os';
import type { Command } from 'commander';
import type { ReviewOptions } from '../../../app/review-service.js';
import { ReviewRenderer, RuleListRenderer } from '../../render/review-renderer.js';
import type { CliCommand, CommandContext } from '../command.js';
import { parsePositiveInt } from '../dates.js';
import { projectQuery } from '../project-query.js';
import { formatOf } from '../options.js';

interface ReviewFlags {
  days?: number;
  session?: string;
  last?: boolean;
  ai?: boolean;
  rule?: string[];
  listRules?: boolean;
  compare?: boolean;
  project?: string;
}

/** `cclens review`: rule-based optimization advice, optionally with an AI second opinion. */
export class ReviewCommand implements CliCommand {
  register(program: Command, ctx: CommandContext): void {
    program
      .command('review')
      .description('review recent sessions and suggest ways to use fewer tokens')
      .option(
        '--days <n>',
        'look back this many days (default: config review.windowDays)',
        parsePositiveInt,
      )
      .option('--session <id>', 'review one session (full id or first characters)')
      .option('--last', 'review the most recent session')
      .option('--ai', 'also ask Claude (claude -p, your login) for suggestions; costs a few tokens')
      .option('--rule <id...>', 'run only these rules')
      .option('--compare', 'compare with the previous window of the same length')
      .option(
        '--project <name>',
        'only this project: a folder path, its name (site), or the full name from `tokens project`',
      )
      .option('--list-rules', 'list the available rules and exit')
      .action(async (flags: ReviewFlags) => {
        const format = formatOf(program);
        if (flags.listRules) {
          const rules = await ctx.services.review.rules();
          ctx.print(ctx.renderer(format, new RuleListRenderer()).render(rules));
          return;
        }
        const options: ReviewOptions = {
          ...(flags.days ? { windowDays: flags.days } : {}),
          ...(flags.session ? { sessionId: flags.session } : {}),
          ...(flags.last ? { last: true } : {}),
          ...(flags.ai ? { ai: true } : {}),
          ...(flags.rule ? { only: flags.rule } : {}),
          ...(flags.compare ? { compare: true } : {}),
          ...(flags.project
            ? { project: projectQuery(flags.project, homedir(), process.cwd()) }
            : {}),
        };
        const report = await ctx.services.review.review(options);
        ctx.print(ctx.renderer(format, new ReviewRenderer()).render(report));
      });
  }
}

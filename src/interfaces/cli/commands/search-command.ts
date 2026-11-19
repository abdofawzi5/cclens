import { Option, type Command } from 'commander';
import type { SearchSort } from '../../../core/domain/search.js';
import { SEARCH_SORTS } from '../../../core/search/ranking.js';
import { SearchRenderer } from '../../render/search-renderer.js';
import type { CliCommand, CommandContext } from '../command.js';
import { parsePositiveInt } from '../dates.js';
import { formatOf } from '../options.js';

interface SearchFlags {
  engine?: string[];
  limit?: number;
  minStars?: number;
  sort?: SearchSort;
  refresh?: boolean;
  archived?: boolean;
}

const nonNegativeInt = (v: string): number => (v === '0' ? 0 : parsePositiveInt(v));

/** `cclens search <query>`: one query across every enabled skill registry. */
export class SearchCommand implements CliCommand {
  register(program: Command, ctx: CommandContext): void {
    program
      .command('search')
      .description('search skill registries (GitHub, SkillsMP, skills.sh…) and rank by stars')
      .argument('<query...>', 'what to look for, e.g. "seo audit"')
      .option('--engine <ids...>', 'only these engines (see `cclens engines`)')
      .option('--limit <n>', 'number of results', parsePositiveInt)
      .option('--min-stars <n>', 'hide results with fewer GitHub stars', nonNegativeInt)
      .addOption(new Option('--sort <order>', 'result order').choices(SEARCH_SORTS))
      .option('--refresh', 'ignore cached results')
      .option('--archived', 'include archived repositories')
      .action(async (words: string[], flags: SearchFlags) => {
        const report = await ctx.services.search.search(words.join(' '), {
          ...(flags.engine
            ? { engines: flags.engine.flatMap((e) => e.split(',')).filter(Boolean) }
            : {}),
          ...(flags.limit ? { limit: flags.limit } : {}),
          ...(flags.minStars === undefined ? {} : { minStars: flags.minStars }),
          ...(flags.sort ? { sort: flags.sort } : {}),
          ...(flags.refresh ? { refresh: true } : {}),
          ...(flags.archived ? { includeArchived: true } : {}),
        });
        const engines = await ctx.services.engines.list();
        const unofficial = new Set(
          engines.filter((e) => e.descriptor?.stability === 'unofficial').map((e) => e.config.id),
        );
        ctx.print(ctx.renderer(formatOf(program), new SearchRenderer(unofficial)).render(report));
      });
  }
}

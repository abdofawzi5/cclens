import { addTokens, totalTokens, ZERO_TOKENS } from '../core/domain/tokens.js';
import type {
  ProjectTokens,
  SessionTokens,
  TokenBucket,
  TokenCounts,
  TokenFilter,
  UsageBlock,
} from '../core/domain/tokens.js';
import { resolveProject } from '../core/domain/projects.js';
import { ValidationError } from '../core/errors.js';
import type { SessionTitle } from '../core/domain/session-labels.js';
import type { SessionActivitySource } from '../core/ports/review.js';
import type { TokenUsageProvider } from '../core/ports/tokens.js';

/** A session's token use plus its name, when the transcript has one. */
export type TitledSessionTokens = SessionTokens & { readonly title?: SessionTitle };

export type TokenView = 'daily' | 'weekly' | 'monthly' | 'session' | 'project' | 'blocks';

export const TOKEN_VIEWS: readonly TokenView[] = [
  'daily',
  'weekly',
  'monthly',
  'session',
  'project',
  'blocks',
];

/** Views that can be narrowed to one project. */
const PROJECT_VIEWS: readonly TokenView[] = ['daily', 'session', 'project'];

export interface TokenTotals {
  readonly counts: TokenCounts;
  readonly total: number;
  readonly costUsd: number;
}

export type TokenReport =
  | {
      readonly view: 'daily' | 'weekly' | 'monthly';
      readonly rows: readonly TokenBucket[];
      readonly totals: TokenTotals;
    }
  | {
      readonly view: 'session';
      readonly rows: readonly TitledSessionTokens[];
      readonly totals: TokenTotals;
    }
  | {
      readonly view: 'project';
      readonly rows: readonly ProjectTokens[];
      readonly totals: TokenTotals;
    }
  | { readonly view: 'blocks'; readonly rows: readonly UsageBlock[]; readonly totals: TokenTotals };

function totalsOf(rows: readonly { counts: TokenCounts; costUsd: number }[]): TokenTotals {
  const counts = rows.reduce<TokenCounts>((acc, r) => addTokens(acc, r.counts), ZERO_TOKENS);
  return { counts, total: totalTokens(counts), costUsd: rows.reduce((a, r) => a + r.costUsd, 0) };
}

/** Token usage reports for every view, each with totals. */
export class TokenService {
  /** `titles` names sessions in the session view; without it rows show ids only. */
  constructor(
    private readonly provider: TokenUsageProvider,
    private readonly titles?: SessionActivitySource,
  ) {}

  async report(view: TokenView, filter: TokenFilter = {}, limit?: number): Promise<TokenReport> {
    if (filter.project && !PROJECT_VIEWS.includes(view)) {
      throw new ValidationError(
        `--project works with the ${PROJECT_VIEWS.join(', ')} views, not ${view}`,
      );
    }
    if (filter.project) filter = { ...filter, project: await this.resolveProject(filter.project) };
    // ccusage filters only its daily report by project; other views filter their own rows.
    const { project, ...unfiltered } = filter;
    const inProject = (r: { project: string }): boolean => !project || r.project === project;
    const latest = <T>(rows: readonly T[]): readonly T[] =>
      limit === undefined ? rows : rows.slice(-limit);
    const top = <T>(rows: readonly T[]): readonly T[] =>
      limit === undefined ? rows : rows.slice(0, limit);

    switch (view) {
      case 'daily':
      case 'weekly':
      case 'monthly': {
        const period = view === 'daily' ? 'day' : view === 'weekly' ? 'week' : 'month';
        const rows = latest(await this.provider.byPeriod(period, filter));
        return { view, rows, totals: totalsOf(rows) };
      }
      case 'session': {
        const [all, titles] = await Promise.all([
          this.provider.bySession(unfiltered),
          this.sessionTitles(filter),
        ]);
        const rows = top([...all.filter(inProject)].sort((a, b) => b.costUsd - a.costUsd)).map(
          (r) => {
            const title = titles.get(r.sessionId);
            return title ? { ...r, title } : r;
          },
        );
        return { view, rows, totals: totalsOf(rows) };
      }
      case 'project': {
        const rows = top((await this.provider.byProject(unfiltered)).filter(inProject));
        return { view, rows, totals: totalsOf(rows) };
      }
      case 'blocks': {
        const rows = latest(await this.provider.blocks(filter));
        return { view, rows, totals: totalsOf(rows) };
      }
    }
  }

  /** Maps a short name (`site`, `Workspace-site`) to the full project name ccusage expects. */
  private async resolveProject(query: string): Promise<string> {
    const known = (await this.provider.byProject()).map((p) => p.project);
    return resolveProject(query, known);
  }

  /** Titles are a nicety: if transcripts cannot be read, the report still works. */
  private async sessionTitles(filter: TokenFilter): Promise<ReadonlyMap<string, SessionTitle>> {
    if (!this.titles) return new Map();
    try {
      const activity = await this.titles.read(filter.since);
      const out = new Map<string, SessionTitle>();
      for (const a of activity) if (a.title) out.set(a.sessionId, a.title);
      return out;
    } catch {
      return new Map();
    }
  }
}

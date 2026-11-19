import { type OverheadSummary, summarizeOverhead } from '../core/domain/overhead.js';
import type { Clock } from '../core/ports/infrastructure.js';
import type { ContextOverheadSource } from '../core/ports/overhead.js';

export interface ContextReport extends OverheadSummary {
  readonly since: Date;
}

/** `cclens context`: what fills the context before the first prompt (PLAN A2). */
export class ContextService {
  constructor(
    private readonly source: ContextOverheadSource,
    private readonly clock: Clock,
  ) {}

  async report(options: { since?: Date; last?: boolean } = {}): Promise<ContextReport> {
    const since = options.since ?? new Date(this.clock.now().getTime() - 14 * 24 * 60 * 60 * 1000);
    const all = await this.source.read(since);
    const sessions = options.last ? all.slice(-1) : all;
    return { since, ...summarizeOverhead(sessions) };
  }
}

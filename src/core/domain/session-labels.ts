/** Where a session's title came from. */
export type SessionTitleSource = 'custom' | 'first-prompt';

/**
 * A human name for a session: the title Claude Code shows (`custom-title` records),
 * or the start of the first typed prompt when there is none.
 */
export interface SessionTitle {
  readonly text: string;
  readonly source: SessionTitleSource;
}

export const SHORT_ID_LENGTH = 8;
export const MAX_TITLE_LENGTH = 60;

export function shortSessionId(id: string): string {
  return id.slice(0, SHORT_ID_LENGTH);
}

/** One line, no runs of spaces, cut to `max` characters with an ellipsis. */
export function cleanTitle(text: string, max = MAX_TITLE_LENGTH): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length <= max ? flat : `${flat.slice(0, max - 1).trimEnd()}…`;
}

/** The result of looking a session up by id prefix or title. */
export type SessionMatch =
  | { readonly kind: 'one'; readonly sessionId: string }
  | { readonly kind: 'none' }
  | { readonly kind: 'many'; readonly sessionIds: readonly string[] };

interface Titled {
  readonly sessionId: string;
  readonly title?: SessionTitle;
}

/** Names sessions for people: `Title (abcd1234)`, or the short id when there is no title. */
export class SessionLabels {
  private constructor(private readonly titles: ReadonlyMap<string, SessionTitle>) {}

  static from(sessions: Iterable<Titled>): SessionLabels {
    const titles = new Map<string, SessionTitle>();
    for (const s of sessions) if (s.title) titles.set(s.sessionId, s.title);
    return new SessionLabels(titles);
  }

  title(sessionId: string): SessionTitle | undefined {
    return this.titles.get(sessionId);
  }

  label(sessionId: string, maxTitle = MAX_TITLE_LENGTH): string {
    const title = this.titles.get(sessionId);
    const id = shortSessionId(sessionId);
    return title ? `${cleanTitle(title.text, maxTitle)} (${id})` : id;
  }

  /**
   * Finds a session by id prefix first, then by a case-insensitive part of its title.
   * An id prefix that matches several sessions is ambiguous; it does not fall back to titles.
   */
  resolve(query: string, sessionIds: Iterable<string>): SessionMatch {
    const ids = [...new Set(sessionIds)];
    const wanted = query.trim();
    const byId = ids.filter((id) => id.startsWith(wanted));
    if (byId.length > 0) return SessionLabels.matchOf(byId);
    const needle = wanted.toLowerCase();
    return SessionLabels.matchOf(
      ids.filter((id) => this.titles.get(id)?.text.toLowerCase().includes(needle)),
    );
  }

  private static matchOf(ids: readonly string[]): SessionMatch {
    if (ids.length === 0) return { kind: 'none' };
    const [only] = ids;
    return ids.length === 1 && only !== undefined
      ? { kind: 'one', sessionId: only }
      : { kind: 'many', sessionIds: ids };
  }
}

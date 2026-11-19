import { createReadStream } from 'node:fs';
import { relative, sep } from 'node:path';
import { createInterface } from 'node:readline';
import { z } from 'zod';
import type { SessionActivity } from '../../../core/domain/review.js';
import type { Logger } from '../../../core/ports/infrastructure.js';
import type { SessionActivitySource } from '../../../core/ports/review.js';
import { walkJsonl } from './jsonl-files.js';

const line = z.looseObject({
  type: z.string(),
  subtype: z.string().optional(),
  uuid: z.string().optional(),
  sessionId: z.string().optional(),
  timestamp: z.iso.datetime(),
  isSidechain: z.boolean().optional(),
  isMeta: z.boolean().optional(),
  isCompactSummary: z.boolean().optional(),
  origin: z.looseObject({ kind: z.string() }).optional(),
  message: z.looseObject({ content: z.unknown() }).optional(),
  compactMetadata: z
    .looseObject({ trigger: z.string().optional(), preTokens: z.number().optional() })
    .optional(),
});

type Line = z.infer<typeof line>;

/** Only user prompts and compaction markers matter; everything else is skipped unparsed. */
const MAY_MATTER = /"type":"user"|"subtype":"compact_boundary"/;
/** Tool results are user lines too, and often huge. */
const TOOL_RESULT = /"tool_use_id"/;

interface Tally {
  sessionId: string;
  project: string;
  first: Date;
  last: Date;
  prompts: number;
  auto: number;
  manual: number;
  peak?: number;
}

/** A prompt the person typed: newer Claude Code marks these `origin.kind: "human"`. */
function isHumanPrompt(l: Line): boolean {
  if (l.type !== 'user' || l.isSidechain || l.isMeta || l.isCompactSummary) return false;
  if (l.origin) return l.origin.kind === 'human';
  const content = l.message?.content;
  return typeof content === 'string' && !content.startsWith('<');
}

/**
 * Reads per-session activity from Claude Code transcripts: prompts typed and
 * compactions (auto or manual, with the context size before each). Never keeps
 * prompt text.
 */
export class TranscriptActivitySource implements SessionActivitySource {
  constructor(
    private readonly projectsDir: string,
    private readonly logger?: Logger,
  ) {}

  async read(since?: Date): Promise<readonly SessionActivity[]> {
    const sessions = new Map<string, Tally>();
    const seen = new Set<string>();
    for await (const file of walkJsonl(this.projectsDir, since)) {
      const rel = relative(this.projectsDir, file).split(sep);
      if (rel.includes('subagents')) continue;
      const project = rel.length > 1 ? (rel[0] ?? '') : '';
      const lines = createInterface({ input: createReadStream(file, 'utf8'), crlfDelay: Infinity });
      for await (const raw of lines) {
        if (!MAY_MATTER.test(raw) || TOOL_RESULT.test(raw)) continue;
        const l = this.parse(raw, file);
        if (!l?.sessionId) continue;
        if (l.uuid) {
          if (seen.has(l.uuid)) continue;
          seen.add(l.uuid);
        }
        const ts = new Date(l.timestamp);
        if (since && ts < since) continue;

        const isCompaction = l.type === 'system' && l.subtype === 'compact_boundary';
        if (!isCompaction && !isHumanPrompt(l)) continue;

        const t = this.tally(sessions, l.sessionId, project, ts);
        if (isCompaction) {
          if (l.compactMetadata?.trigger === 'manual') t.manual++;
          else t.auto++;
          const pre = l.compactMetadata?.preTokens;
          if (pre !== undefined) t.peak = Math.max(t.peak ?? 0, pre);
        } else {
          t.prompts++;
        }
      }
    }
    return [...sessions.values()].map((t) => ({
      sessionId: t.sessionId,
      project: t.project,
      firstActivity: t.first,
      lastActivity: t.last,
      prompts: t.prompts,
      autoCompactions: t.auto,
      manualCompactions: t.manual,
      ...(t.peak === undefined ? {} : { peakContextTokens: t.peak }),
    }));
  }

  private tally(map: Map<string, Tally>, sessionId: string, project: string, ts: Date): Tally {
    let t = map.get(sessionId);
    if (!t) {
      t = { sessionId, project, first: ts, last: ts, prompts: 0, auto: 0, manual: 0 };
      map.set(sessionId, t);
    }
    if (ts < t.first) t.first = ts;
    if (ts > t.last) t.last = ts;
    return t;
  }

  private parse(raw: string, file: string): Line | undefined {
    try {
      const parsed = line.safeParse(JSON.parse(raw));
      return parsed.success ? parsed.data : undefined;
    } catch {
      this.logger?.debug('Skipped unreadable transcript line', { file });
      return undefined;
    }
  }
}

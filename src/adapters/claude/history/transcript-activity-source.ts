import { createReadStream } from 'node:fs';
import { relative, sep } from 'node:path';
import { createInterface } from 'node:readline';
import { z } from 'zod';
import type { SessionActivity } from '../../../core/domain/review.js';
import { cleanTitle, type SessionTitle } from '../../../core/domain/session-labels.js';
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
  origin: z.looseObject({ kind: z.string(), subkind: z.string().optional() }).optional(),
  message: z.looseObject({ content: z.unknown() }).optional(),
  compactMetadata: z
    .looseObject({ trigger: z.string().optional(), preTokens: z.number().optional() })
    .optional(),
});

type Line = z.infer<typeof line>;

/** `{"type":"custom-title","customTitle":"…","sessionId":"…"}`: no timestamp, last one wins. */
const titleLine = z.looseObject({
  type: z.literal('custom-title'),
  customTitle: z.string(),
  sessionId: z.string(),
});

/** Only prompts, compaction markers and titles matter; everything else is skipped unparsed. */
const MAY_MATTER = /"type":"user"|"subtype":"compact_boundary"|"type":"custom-title"/;
const TITLE = /"type":"custom-title"/;
const textBlock = z.looseObject({ type: z.literal('text'), text: z.string() });
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
  /** Name of the scheduled task that started this session, if any. */
  scheduledTask?: string;
  /** Start of the earliest typed prompt; the fallback title. */
  firstPrompt?: { text: string; at: Date };
}

/** A prompt the person typed: newer Claude Code marks these `origin.kind: "human"`. */
function isHumanPrompt(l: Line): boolean {
  if (l.type !== 'user' || l.isSidechain || l.isMeta || l.isCompactSummary) return false;
  if (l.origin) return l.origin.kind === 'human';
  const content = l.message?.content;
  return typeof content === 'string' && !content.startsWith('<');
}

/** `<scheduled-task name="daily-report" …>` → `daily-report`. Only the name is kept. */
function scheduledTaskName(l: Line): string {
  const content = l.message?.content;
  const text =
    typeof content === 'string'
      ? content
      : Array.isArray(content)
        ? (content as unknown[])
            .map((b) => {
              const parsed = textBlock.safeParse(b);
              return parsed.success ? parsed.data.text : '';
            })
            .join('')
        : '';
  return /<scheduled-task\b[^>]*\bname="([^"]{1,200})"/.exec(text)?.[1] ?? 'scheduled task';
}

/** The visible text of a prompt; a slash command becomes `/name args`. */
function promptText(l: Line): string | undefined {
  const content = l.message?.content;
  let text: string | undefined;
  if (typeof content === 'string') text = content;
  else if (Array.isArray(content)) {
    for (const block of content as unknown[]) {
      const parsed = textBlock.safeParse(block);
      if (parsed.success) {
        text = parsed.data.text;
        break;
      }
    }
  }
  if (text === undefined) return undefined;
  const command = /<command-name>([^<]+)<\/command-name>/.exec(text)?.[1];
  if (command) {
    const args = /<command-args>([^<]*)<\/command-args>/.exec(text)?.[1] ?? '';
    text = `${command} ${args}`;
  } else if (text.startsWith('<')) {
    return undefined;
  }
  const cleaned = cleanTitle(text);
  return cleaned || undefined;
}

/**
 * Reads per-session activity from Claude Code transcripts: prompts typed,
 * compactions (auto or manual, with the context size before each) and the
 * session's title. The only prompt text kept is the first prompt's opening
 * words, as a fallback title for sessions without one; it never leaves the machine.
 */
export class TranscriptActivitySource implements SessionActivitySource {
  constructor(
    private readonly projectsDir: string,
    private readonly logger?: Logger,
  ) {}

  async read(since?: Date): Promise<readonly SessionActivity[]> {
    const sessions = new Map<string, Tally>();
    const titles = new Map<string, string>();
    const seen = new Set<string>();
    for await (const file of walkJsonl(this.projectsDir, since)) {
      const rel = relative(this.projectsDir, file).split(sep);
      if (rel.includes('subagents')) continue;
      const project = rel.length > 1 ? (rel[0] ?? '') : '';
      const lines = createInterface({ input: createReadStream(file, 'utf8'), crlfDelay: Infinity });
      for await (const raw of lines) {
        if (!MAY_MATTER.test(raw) || TOOL_RESULT.test(raw)) continue;
        if (TITLE.test(raw)) {
          const t = this.parseTitle(raw);
          if (t) titles.set(t.sessionId, t.text);
          continue;
        }
        const l = this.parse(raw, file);
        if (!l?.sessionId) continue;
        if (l.uuid) {
          if (seen.has(l.uuid)) continue;
          seen.add(l.uuid);
        }
        const ts = new Date(l.timestamp);
        if (since && ts < since) continue;

        const isCompaction = l.type === 'system' && l.subtype === 'compact_boundary';
        const isUserTurn = l.type === 'user' && !l.isSidechain && !l.isMeta;
        if (!isCompaction && !isUserTurn) continue;

        const t = this.tally(sessions, l.sessionId, project, ts);
        if (!isCompaction && l.origin?.subkind === 'scheduled-trigger') {
          t.scheduledTask ??= scheduledTaskName(l);
        }
        // Scheduled runs start from a trigger, not a typed prompt: register the session, count nothing.
        if (!isCompaction && !isHumanPrompt(l)) continue;
        if (isCompaction) {
          if (l.compactMetadata?.trigger === 'manual') t.manual++;
          else t.auto++;
          const pre = l.compactMetadata?.preTokens;
          if (pre !== undefined) t.peak = Math.max(t.peak ?? 0, pre);
        } else {
          t.prompts++;
          if (!t.firstPrompt || ts < t.firstPrompt.at) {
            const text = promptText(l);
            if (text) t.firstPrompt = { text, at: ts };
          }
        }
      }
    }
    return [...sessions.values()].map((t) => {
      const custom = titles.get(t.sessionId);
      const title: SessionTitle | undefined = custom
        ? { text: custom, source: 'custom' }
        : t.firstPrompt
          ? { text: t.firstPrompt.text, source: 'first-prompt' }
          : undefined;
      return {
        sessionId: t.sessionId,
        project: t.project,
        firstActivity: t.first,
        lastActivity: t.last,
        prompts: t.prompts,
        autoCompactions: t.auto,
        manualCompactions: t.manual,
        ...(t.peak === undefined ? {} : { peakContextTokens: t.peak }),
        ...(title ? { title } : {}),
        ...(t.scheduledTask ? { scheduledTask: t.scheduledTask } : {}),
      };
    });
  }

  private parseTitle(raw: string): { sessionId: string; text: string } | undefined {
    try {
      const parsed = titleLine.safeParse(JSON.parse(raw));
      if (!parsed.success) return undefined;
      const text = cleanTitle(parsed.data.customTitle, 200);
      return text ? { sessionId: parsed.data.sessionId, text } : undefined;
    } catch {
      return undefined;
    }
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

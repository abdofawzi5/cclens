import { createReadStream } from 'node:fs';
import { relative, sep } from 'node:path';
import { createInterface } from 'node:readline';
import { z } from 'zod';
import type { FileRead, SessionActivity, SessionTurns } from '../../../core/domain/review.js';
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
  cwd: z.string().optional(),
  message: z
    .looseObject({
      content: z.unknown(),
      id: z.string().optional(),
      model: z.string().optional(),
      usage: z
        .looseObject({
          input_tokens: z.number().optional(),
          cache_read_input_tokens: z.number().optional(),
          cache_creation_input_tokens: z.number().optional(),
        })
        .optional(),
    })
    .optional(),
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

/** Prompts, model calls, compaction markers and titles matter; everything else is skipped unparsed. */
const MAY_MATTER =
  /"type":"user"|"type":"assistant"|"subtype":"compact_boundary"|"type":"custom-title"/;
const TITLE = /"type":"custom-title"/;
const textBlock = z.looseObject({ type: z.literal('text'), text: z.string() });
/** Tool results are user lines too, and often huge: only their length is used. */
const TOOL_RESULT = /"tool_use_id"/;
const TOOL_RESULT_ID = /"tool_use_id":"([^"]+)"/g;
const toolUse = z.looseObject({
  type: z.literal('tool_use'),
  id: z.string(),
  name: z.string(),
  input: z.looseObject({ file_path: z.string().optional() }).optional(),
});
const IMAGE = /\.(?:png|jpe?g|gif|webp)$/i;
/** File reads kept per session (largest first). */
const MAX_FILE_READS = 20;

/** Model calls and tool use of one session's main thread. */
interface TurnTally {
  /** Context per assistant message id (streamed messages repeat their usage). */
  calls: Map<string, number>;
  first?: { at: Date; tokens: number };
  models: Map<string, number>;
  toolIds: Set<string>;
  toolCalls: number;
  shellCalls: number;
  imageReads: number;
  reads: Map<string, number>;
  mcp: Set<string>;
}

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
  cwd?: string;
  turns?: TurnTally;
}

function newTurns(): TurnTally {
  return {
    calls: new Map(),
    models: new Map(),
    toolIds: new Set(),
    toolCalls: 0,
    shellCalls: 0,
    imageReads: 0,
    reads: new Map(),
    mcp: new Set(),
  };
}

function turnsOf(t: TurnTally | undefined): SessionTurns | undefined {
  if (!t || t.calls.size === 0) return undefined;
  const sizes = [...t.calls.values()];
  const mainModel = [...t.models.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  const fileReads: FileRead[] = [...t.reads.entries()]
    .map(([path, tokens]) => ({ path, tokens }))
    .sort((a, b) => b.tokens - a.tokens)
    .slice(0, MAX_FILE_READS);
  return {
    modelCalls: t.calls.size,
    firstContextTokens: t.first?.tokens ?? sizes[0] ?? 0,
    contextTokens: sizes.reduce((n, x) => n + x, 0),
    maxContextTokens: Math.max(...sizes),
    ...(mainModel ? { mainModel } : {}),
    toolCalls: t.toolCalls,
    shellCalls: t.shellCalls,
    imageReads: t.imageReads,
    fileReads,
    mcpServersUsed: [...t.mcp].sort(),
  };
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
    /** Read tool calls waiting for their result: tool_use id → where to record the size. */
    const pendingReads = new Map<string, { reads: Map<string, number>; path: string }>();
    for await (const file of walkJsonl(this.projectsDir, since)) {
      const rel = relative(this.projectsDir, file).split(sep);
      if (rel.includes('subagents')) continue;
      const project = rel.length > 1 ? (rel[0] ?? '') : '';
      const lines = createInterface({ input: createReadStream(file, 'utf8'), crlfDelay: Infinity });
      for await (const raw of lines) {
        if (!MAY_MATTER.test(raw)) continue;
        if (TOOL_RESULT.test(raw)) {
          this.readSize(raw, pendingReads);
          continue;
        }
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

        if (l.type === 'assistant') {
          if (!l.isSidechain) {
            this.assistant(
              this.tally(sessions, l.sessionId, project, ts, false),
              l,
              ts,
              pendingReads,
            );
          }
          continue;
        }
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
      const turns = turnsOf(t.turns);
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
        ...(t.cwd ? { cwd: t.cwd } : {}),
        ...(turns ? { turns } : {}),
      };
    });
  }

  /** One assistant line: the call's context size, model and the tools it called. */
  private assistant(
    t: Tally,
    l: Line,
    ts: Date,
    pendingReads: Map<string, { reads: Map<string, number>; path: string }>,
  ): void {
    if (l.cwd) t.cwd ??= l.cwd;
    const m = l.message;
    if (!m) return;
    const turns = (t.turns ??= newTurns());
    const u = m.usage;
    if (u && m.model !== '<synthetic>') {
      const tokens =
        (u.input_tokens ?? 0) +
        (u.cache_read_input_tokens ?? 0) +
        (u.cache_creation_input_tokens ?? 0);
      const id = m.id ?? l.uuid ?? ts.toISOString();
      if (!turns.calls.has(id)) {
        turns.calls.set(id, tokens);
        if (m.model) turns.models.set(m.model, (turns.models.get(m.model) ?? 0) + 1);
        if (!turns.first || ts < turns.first.at) turns.first = { at: ts, tokens };
      }
    }
    if (!Array.isArray(m.content)) return;
    for (const block of m.content as unknown[]) {
      const parsed = toolUse.safeParse(block);
      if (!parsed.success) continue;
      const { id, name, input } = parsed.data;
      if (turns.toolIds.has(id)) continue;
      turns.toolIds.add(id);
      turns.toolCalls++;
      if (name === 'Bash') turns.shellCalls++;
      const server = /^mcp__(.+?)__/.exec(name)?.[1];
      if (server) turns.mcp.add(server);
      const path = input?.file_path;
      if (name === 'Read' && path) {
        if (IMAGE.test(path)) turns.imageReads++;
        else pendingReads.set(id, { reads: turns.reads, path });
      }
    }
  }

  /** A Read result's size, estimated from the raw line (~4 characters per token). */
  private readSize(
    raw: string,
    pendingReads: Map<string, { reads: Map<string, number>; path: string }>,
  ): void {
    const ids = [...raw.matchAll(TOOL_RESULT_ID)].map((x) => x[1] ?? '');
    const reads = ids.flatMap((id) => {
      const r = pendingReads.get(id);
      if (!r) return [];
      pendingReads.delete(id);
      return [r];
    });
    if (reads.length === 0) return;
    const tokens = Math.round(raw.length / 4 / reads.length);
    for (const r of reads) r.reads.set(r.path, Math.max(r.reads.get(r.path) ?? 0, tokens));
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

  /** `touch: false` (model calls) records the session without moving its activity times. */
  private tally(
    map: Map<string, Tally>,
    sessionId: string,
    project: string,
    ts: Date,
    touch = true,
  ): Tally {
    let t = map.get(sessionId);
    if (!t) {
      t = { sessionId, project, first: ts, last: ts, prompts: 0, auto: 0, manual: 0 };
      map.set(sessionId, t);
    }
    if (!touch) return t;
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

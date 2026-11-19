import { createReadStream } from 'node:fs';
import { relative, sep } from 'node:path';
import { createInterface } from 'node:readline';
import { z } from 'zod';
import {
  type InstructionFile,
  mcpServerOf,
  type McpServerTools,
  type OverheadPart,
  parseSkillListing,
  type SessionOverhead,
  withUnrecorded,
} from '../../../core/domain/overhead.js';
import type { Logger } from '../../../core/ports/infrastructure.js';
import type { ContextOverheadSource } from '../../../core/ports/overhead.js';
import { estimateTokens } from '../../../core/util/estimate-tokens.js';
import { walkJsonl } from './jsonl-files.js';

/*
 * Reads the start of each session transcript up to its first reply. Claude Code
 * records what it put in the context as `attachment` lines (skill listing, deferred
 * tool names, CLAUDE.md files, …) and the reply's usage gives the exact request size.
 * Older transcripts without these lines show everything as "the rest".
 */

const strings = z.array(z.string()).catch([]);

const attachment = z.looseObject({ type: z.string() });
const snapshot = z.looseObject({ systemPrompt: strings });
const toolsDelta = z.looseObject({ addedNames: strings, addedLines: strings });
const blocksDelta = z.looseObject({ addedBlocks: strings });
const linesDelta = z.looseObject({ addedLines: strings });
const skillListing = z.looseObject({
  content: z.string().catch(''),
  skillCount: z.number().optional().catch(undefined),
});
const instructions = z.looseObject({
  files: z
    .array(
      z.looseObject({
        path: z.string().catch(''),
        type: z.string().catch(''),
        content: z.string().catch(''),
      }),
    )
    .catch([]),
});

const line = z.looseObject({
  type: z.string(),
  timestamp: z.string().optional(),
  sessionId: z.string().optional(),
  isMeta: z.boolean().optional(),
  attachment: attachment.optional(),
  message: z
    .looseObject({
      content: z.unknown().optional(),
      usage: z
        .looseObject({
          input_tokens: z.number().optional(),
          cache_creation_input_tokens: z.number().optional(),
          cache_read_input_tokens: z.number().optional(),
        })
        .optional(),
    })
    .optional(),
});

/** Session details that are small and always present; counted as one part. */
const SESSION_ATTACHMENTS = new Set([
  'environment',
  'model',
  'date',
  'session_context',
  'auto_mode',
]);

/** Stop reading a transcript after this many lines without a reply. */
const MAX_LINES = 400;

const joined = (xs: readonly string[]): number => estimateTokens(xs.join('\n'));

const textField = (v: unknown): string => (typeof v === 'string' ? v : '');

interface Usage {
  readonly input_tokens?: number | undefined;
  readonly cache_creation_input_tokens?: number | undefined;
  readonly cache_read_input_tokens?: number | undefined;
}

function textOf(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .map((b: unknown) =>
      b && typeof b === 'object' && (b as { type?: unknown }).type === 'text'
        ? textField((b as { text?: unknown }).text)
        : '',
    )
    .join('\n');
}

class Collector {
  readonly measured: Partial<Record<OverheadPart, number>> = {};
  readonly servers = new Map<string, { tools: number; tokens: number; example: string }>();
  readonly files: InstructionFile[] = [];
  toolNames = 0;
  skills: number | undefined;
  listing: Record<string, number> = {};
  prompt = '';

  add(part: OverheadPart, tokens: number): void {
    this.measured[part] = (this.measured[part] ?? 0) + tokens;
  }

  attachment(a: z.infer<typeof attachment>): void {
    switch (a.type) {
      case 'prompt_snapshot':
        this.add('system-prompt', joined(snapshot.parse(a).systemPrompt));
        return;
      case 'deferred_tools_delta': {
        const d = toolsDelta.parse(a);
        const lines = d.addedLines.length === d.addedNames.length ? d.addedLines : d.addedNames;
        this.add('tool-names', joined(lines));
        this.toolNames += d.addedNames.length;
        d.addedNames.forEach((name, i) => {
          const server = mcpServerOf(name);
          if (!server) return;
          const s = this.servers.get(server) ?? {
            tools: 0,
            tokens: 0,
            example: name.slice(`mcp__${server}__`.length),
          };
          s.tools += 1;
          s.tokens += estimateTokens(`${lines[i] ?? name}\n`);
          this.servers.set(server, s);
        });
        return;
      }
      case 'mcp_instructions_delta':
        this.add('mcp-instructions', joined(blocksDelta.parse(a).addedBlocks));
        return;
      case 'skill_listing': {
        const s = skillListing.parse(a);
        this.add('skills', estimateTokens(s.content));
        Object.assign(this.listing, parseSkillListing(s.content));
        if (s.skillCount !== undefined) this.skills = (this.skills ?? 0) + s.skillCount;
        return;
      }
      case 'agent_listing_delta':
        this.add('agents', joined(linesDelta.parse(a).addedLines));
        return;
      case 'instructions':
        for (const f of instructions.parse(a).files) {
          const tokens = estimateTokens(f.content);
          this.add('instructions', tokens);
          this.files.push({ path: f.path, kind: f.type, tokens });
        }
        return;
      default:
        if (SESSION_ATTACHMENTS.has(a.type)) this.add('session', estimateTokens(JSON.stringify(a)));
    }
  }

  build(sessionId: string, project: string, at: Date, usage: Usage): SessionOverhead {
    const requestTokens =
      (usage.input_tokens ?? 0) +
      (usage.cache_creation_input_tokens ?? 0) +
      (usage.cache_read_input_tokens ?? 0);
    const promptTokens = estimateTokens(this.prompt);
    const mcpServers: McpServerTools[] = [...this.servers]
      .map(([server, s]) => ({ server, ...s }))
      .sort((a, b) => b.tokens - a.tokens);
    return {
      sessionId,
      project,
      at,
      requestTokens,
      promptTokens,
      parts: withUnrecorded(requestTokens, promptTokens, this.measured),
      toolNames: this.toolNames,
      mcpServers,
      instructionFiles: [...this.files].sort((a, b) => b.tokens - a.tokens),
      ...(this.skills !== undefined ? { skills: this.skills } : {}),
      ...(Object.keys(this.listing).length > 0 ? { skillListing: this.listing } : {}),
    };
  }
}

/** Adapter: ContextOverheadSource over `~/.claude/projects/<project>/<session>.jsonl`. */
export class TranscriptOverheadSource implements ContextOverheadSource {
  constructor(
    private readonly projectsDir: string,
    private readonly logger?: Logger,
  ) {}

  async read(since?: Date): Promise<readonly SessionOverhead[]> {
    const out: SessionOverhead[] = [];
    for await (const file of walkJsonl(this.projectsDir, since)) {
      const rel = relative(this.projectsDir, file).split(sep);
      if (rel.includes('subagents')) continue;
      const project = rel.length > 1 ? (rel[0] ?? '') : '';
      try {
        const s = await this.readOne(file, project);
        if (s && (!since || s.at >= since)) out.push(s);
      } catch (error) {
        this.logger?.debug('overhead: skipped transcript', { file, error: String(error) });
      }
    }
    return out.sort((a, b) => a.at.getTime() - b.at.getTime());
  }

  private async readOne(file: string, project: string): Promise<SessionOverhead | undefined> {
    const input = createReadStream(file, 'utf8');
    const lines = createInterface({ input, crlfDelay: Infinity });
    const c = new Collector();
    let sessionId: string | undefined;
    let at: Date | undefined;
    let n = 0;
    try {
      for await (const raw of lines) {
        if (++n > MAX_LINES) return undefined;
        let json: unknown;
        try {
          json = JSON.parse(raw);
        } catch {
          continue;
        }
        const parsed = line.safeParse(json);
        if (!parsed.success) continue;
        const l = parsed.data;
        sessionId ??= l.sessionId;
        if (!at && l.timestamp) {
          const d = new Date(l.timestamp);
          if (!Number.isNaN(d.getTime())) at = d;
        }
        if (l.type === 'attachment' && l.attachment) c.attachment(l.attachment);
        else if (l.type === 'user' && !l.isMeta) {
          const text = textOf(l.message?.content);
          if (text) c.prompt += `${text}\n`;
        } else if (l.type === 'assistant' && l.message?.usage) {
          if (!sessionId || !at) return undefined;
          return c.build(sessionId, project, at, l.message.usage);
        }
      }
      return undefined;
    } finally {
      lines.close();
      input.destroy();
    }
  }
}

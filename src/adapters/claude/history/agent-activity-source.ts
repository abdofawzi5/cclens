import { createReadStream } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { basename, dirname, join, relative, sep } from 'node:path';
import { createInterface } from 'node:readline';
import { z } from 'zod';
import type { AgentActivity, AgentRun, ModelTokens } from '../../../core/domain/agent.js';
import { addTokens, type TokenCounts, ZERO_TOKENS } from '../../../core/domain/tokens.js';
import type { AgentActivitySource } from '../../../core/ports/agents.js';
import type { Logger } from '../../../core/ports/infrastructure.js';
import { walkJsonl } from './jsonl-files.js';

/** Claude Code's default when the Agent call names no type. */
const DEFAULT_TYPE = 'general-purpose';
const AGENT_TOOLS = new Set(['Agent', 'Task']);
const RUN_FILE = /^agent-(.+)\.jsonl$/;

const toolUse = z.looseObject({
  type: z.literal('tool_use'),
  id: z.string(),
  name: z.string(),
  input: z.looseObject({ subagent_type: z.string().optional() }).optional(),
});
const toolResult = z.looseObject({ type: z.literal('tool_result'), tool_use_id: z.string() });

const parentLine = z.looseObject({
  timestamp: z.iso.datetime().optional(),
  isSidechain: z.boolean().optional(),
  message: z.looseObject({ content: z.unknown() }).optional(),
  toolUseResult: z.unknown().optional(),
});
const launched = z.looseObject({ agentId: z.string() });

const usage = z.looseObject({
  input_tokens: z.number().optional(),
  output_tokens: z.number().optional(),
  cache_creation_input_tokens: z.number().optional(),
  cache_read_input_tokens: z.number().optional(),
});
const runLine = z.looseObject({
  type: z.string(),
  timestamp: z.iso.datetime().optional(),
  sessionId: z.string().optional(),
  requestId: z.string().optional(),
  message: z
    .looseObject({
      id: z.string().optional(),
      model: z.string().optional(),
      usage: usage.optional(),
    })
    .optional(),
});
const meta = z.looseObject({ agentType: z.string().min(1) });

/** Only lines that can hold an Agent call or a launched agent's id are parsed. */
const PARENT_MAY_MATTER = /"name":"(?:Agent|Task)"|"agentId"/;

/**
 * Reads subagent runs from `<project>/<session>/subagents/agent-<id>.jsonl` (token
 * counts per model, deduplicated per API response the way ccusage does) and counts
 * Agent tool calls in the main transcripts. The agent type comes from the run's
 * `.meta.json`, or else from the Agent call that launched it. No prompt text is kept.
 */
export class TranscriptAgentSource implements AgentActivitySource {
  constructor(
    private readonly projectsDir: string,
    private readonly logger?: Logger,
  ) {}

  async read(since?: Date): Promise<AgentActivity> {
    const calls = new Map<string, number>();
    /** tool_use id → subagent type, and launched agent id → subagent type. */
    const typeByCall = new Map<string, string>();
    const typeByAgent = new Map<string, string>();
    const runFiles: string[] = [];

    for await (const file of walkJsonl(this.projectsDir, since)) {
      const rel = relative(this.projectsDir, file).split(sep);
      if (rel.includes('subagents')) {
        if (RUN_FILE.test(basename(file))) runFiles.push(file);
        continue;
      }
      await this.readParent(file, since, calls, typeByCall, typeByAgent);
    }

    const runs: AgentRun[] = [];
    for (const file of runFiles) {
      const run = await this.readRun(file, typeByAgent);
      if (run && (!since || run.end >= since)) runs.push(run);
    }
    runs.sort((a, b) => a.start.getTime() - b.start.getTime());
    return { runs, calls };
  }

  private async readParent(
    file: string,
    since: Date | undefined,
    calls: Map<string, number>,
    typeByCall: Map<string, string>,
    typeByAgent: Map<string, string>,
  ): Promise<void> {
    for await (const raw of lines(file)) {
      if (!PARENT_MAY_MATTER.test(raw)) continue;
      const l = parse(parentLine, raw);
      if (!l || l.isSidechain) continue;
      const content = l.message?.content;
      if (!Array.isArray(content)) continue;
      for (const block of content as unknown[]) {
        const use = toolUse.safeParse(block);
        if (use.success && AGENT_TOOLS.has(use.data.name)) {
          const type = use.data.input?.subagent_type ?? DEFAULT_TYPE;
          typeByCall.set(use.data.id, type);
          if (!since || !l.timestamp || new Date(l.timestamp) >= since) {
            calls.set(type, (calls.get(type) ?? 0) + 1);
          }
          continue;
        }
        const result = toolResult.safeParse(block);
        const agent = launched.safeParse(l.toolUseResult);
        if (result.success && agent.success) {
          const type = typeByCall.get(result.data.tool_use_id);
          if (type) typeByAgent.set(agent.data.agentId, type);
        }
      }
    }
  }

  private async readRun(
    file: string,
    typeByAgent: ReadonlyMap<string, string>,
  ): Promise<AgentRun | undefined> {
    const agentId = RUN_FILE.exec(basename(file))?.[1] ?? '';
    const rel = relative(this.projectsDir, file).split(sep);
    const project = rel[0] ?? '';
    let sessionId = rel.length >= 4 ? (rel[1] ?? '') : '';

    const byModel = new Map<string, TokenCounts>();
    const seen = new Set<string>();
    let start: Date | undefined;
    let end: Date | undefined;
    for await (const raw of lines(file)) {
      const l = parse(runLine, raw, this.logger, file);
      if (!l) continue;
      if (l.sessionId) sessionId ||= l.sessionId;
      if (l.timestamp) {
        const at = new Date(l.timestamp);
        if (!start || at < start) start = at;
        if (!end || at > end) end = at;
      }
      const m = l.message;
      if (l.type !== 'assistant' || !m?.usage || !m.model || m.model === '<synthetic>') continue;
      // Streaming writes one line per content block with the same usage; count each response once.
      if (m.id && l.requestId) {
        const key = `${m.id}:${l.requestId}`;
        if (seen.has(key)) continue;
        seen.add(key);
      }
      const counts: TokenCounts = {
        input: m.usage.input_tokens ?? 0,
        output: m.usage.output_tokens ?? 0,
        cacheCreation: m.usage.cache_creation_input_tokens ?? 0,
        cacheRead: m.usage.cache_read_input_tokens ?? 0,
      };
      byModel.set(m.model, addTokens(byModel.get(m.model) ?? ZERO_TOKENS, counts));
    }
    if (!start || !end || !sessionId) return undefined;

    const models: ModelTokens[] = [...byModel].map(([model, counts]) => ({ model, counts }));
    return {
      sessionId,
      project,
      agentId,
      agentType: (await this.metaType(file, agentId)) ?? typeByAgent.get(agentId) ?? 'unknown',
      start,
      end,
      counts: models.reduce((acc, m) => addTokens(acc, m.counts), ZERO_TOKENS),
      byModel: models,
    };
  }

  private async metaType(file: string, agentId: string): Promise<string | undefined> {
    try {
      const raw: unknown = JSON.parse(
        await readFile(join(dirname(file), `agent-${agentId}.meta.json`), 'utf8'),
      );
      const parsed = meta.safeParse(raw);
      return parsed.success ? parsed.data.agentType : undefined;
    } catch {
      return undefined;
    }
  }
}

function lines(file: string): AsyncIterable<string> {
  return createInterface({ input: createReadStream(file, 'utf8'), crlfDelay: Infinity });
}

function parse<T extends z.ZodType>(
  schema: T,
  raw: string,
  logger?: Logger,
  file?: string,
): z.infer<T> | undefined {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    if (raw.trim()) logger?.debug('Skipping unreadable transcript line', { file });
    return undefined;
  }
  const result = schema.safeParse(json);
  return result.success ? result.data : undefined;
}

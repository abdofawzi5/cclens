import { createReadStream } from 'node:fs';
import { basename } from 'node:path';
import { createInterface } from 'node:readline';
import { z } from 'zod';
import { extractTypedCommand } from '../../../core/domain/commands.js';
import { USAGE_EVENT_VERSION, type UsageEvent } from '../../../core/domain/usage-event.js';
import type { Logger } from '../../../core/ports/infrastructure.js';
import type { UsageHistorySource } from '../../../core/ports/usage.js';
import { walkJsonl } from './jsonl-files.js';

const contentBlock = z.looseObject({
  type: z.string(),
  id: z.string().optional(),
  name: z.string().optional(),
  input: z.record(z.string(), z.unknown()).optional(),
  text: z.string().optional(),
});

const transcriptLine = z.looseObject({
  type: z.string(),
  timestamp: z.iso.datetime().optional(),
  sessionId: z.string().optional(),
  cwd: z.string().optional(),
  message: z
    .looseObject({ content: z.union([z.string(), z.array(contentBlock)]).optional() })
    .optional(),
});

type Line = z.infer<typeof transcriptLine>;

/** Cheap pre-filter so only lines that can matter are JSON-parsed. */
const MAY_MATTER = /"name":"Skill"|<command-name>/;

function textOf(line: Line): string {
  const content = line.message?.content;
  if (typeof content === 'string') return content;
  return (content ?? []).map((b) => b.text ?? '').join(' ');
}

/**
 * Recovers past skill uses from Claude Code transcripts (`~/.claude/projects/**\/*.jsonl`):
 * - assistant `tool_use` blocks named `Skill` (Claude ran a skill);
 * - user messages carrying `<command-name>/x</command-name>` (the user typed a command).
 * Transcripts repeat a message while it streams, so tool uses are de-duplicated by id.
 */
export class TranscriptSource implements UsageHistorySource {
  readonly id = 'transcripts';
  readonly description = 'past skill uses from Claude Code transcripts';

  constructor(
    private readonly projectsDir: string,
    private readonly logger?: Logger,
  ) {}

  async *read(since?: Date): AsyncIterable<UsageEvent> {
    const seenToolUses = new Set<string>();
    for await (const file of walkJsonl(this.projectsDir, since)) {
      const lines = createInterface({ input: createReadStream(file, 'utf8'), crlfDelay: Infinity });
      for await (const raw of lines) {
        if (!MAY_MATTER.test(raw)) continue;
        const line = this.parse(raw, file);
        if (!line?.timestamp) continue;
        const ts = new Date(line.timestamp);
        if (since && ts < since) continue;
        const project = line.cwd ? basename(line.cwd) : '';
        const session = line.sessionId === undefined ? {} : { sessionId: line.sessionId };
        const base = {
          v: USAGE_EVENT_VERSION,
          ts,
          source: 'backfill' as const,
          project,
          ...session,
        };

        if (line.type === 'assistant' && Array.isArray(line.message?.content)) {
          for (const block of line.message.content) {
            const skill = block.input?.['skill'];
            if (block.type !== 'tool_use' || block.name !== 'Skill' || typeof skill !== 'string') {
              continue;
            }
            const key = block.id ?? `${line.timestamp}|${skill}`;
            if (seenToolUses.has(key)) continue;
            seenToolUses.add(key);
            yield { ...base, skill };
          }
        } else if (line.type === 'user') {
          const typed = extractTypedCommand(textOf(line));
          if (typed) yield { ...base, skill: typed };
        }
      }
    }
  }

  private parse(raw: string, file: string): Line | undefined {
    try {
      const parsed = transcriptLine.safeParse(JSON.parse(raw));
      return parsed.success ? parsed.data : undefined;
    } catch {
      this.logger?.debug('Skipped unreadable transcript line', { file });
      return undefined;
    }
  }
}

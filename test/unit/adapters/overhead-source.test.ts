import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { TranscriptOverheadSource } from '../../../src/adapters/claude/history/overhead-source.js';

const ts = '2026-11-19T10:00:00.000Z';
const att = (attachment: Record<string, unknown>) =>
  JSON.stringify({ type: 'attachment', timestamp: ts, sessionId: 's1', attachment });

/** Strings whose length is a multiple of 4, so the expected tokens are exact. */
const text = (tokens: number): string => 'abcd'.repeat(tokens);

describe('TranscriptOverheadSource', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'cclens-overhead-'));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('measures each part before the first reply and leaves the rest to the exact total', async () => {
    const lines = [
      JSON.stringify({ type: 'queue-operation' }),
      JSON.stringify({
        type: 'user',
        timestamp: ts,
        sessionId: 's1',
        message: { content: text(5) },
      }),
      att({ type: 'prompt_snapshot', systemPrompt: [text(100), text(50)] }),
      att({
        type: 'deferred_tools_delta',
        addedNames: ['WebSearch', 'mcp__gmail__send', 'mcp__gmail__read'],
        addedLines: ['WebSearch', 'mcp__gmail__send', 'mcp__gmail__read'],
      }),
      att({ type: 'mcp_instructions_delta', addedNames: ['gmail'], addedBlocks: [text(20)] }),
      att({ type: 'skill_listing', content: `- a: ${text(9)}\n- b`, skillCount: 2 }),
      att({ type: 'agent_listing_delta', addedLines: [text(7)] }),
      att({
        type: 'instructions',
        files: [{ path: '/p/CLAUDE.md', type: 'Project', content: text(30) }],
      }),
      att({ type: 'date', date: '2026-11-19' }),
      att({ type: 'credential_org', organizationUuid: 'x' }),
      JSON.stringify({
        type: 'assistant',
        timestamp: ts,
        sessionId: 's1',
        message: {
          content: [],
          usage: {
            input_tokens: 2,
            cache_creation_input_tokens: 1000,
            cache_read_input_tokens: 498,
          },
        },
      }),
      att({ type: 'skill_listing', content: text(999) }),
    ];
    await mkdir(join(dir, 'proj', 's1', 'subagents'), { recursive: true });
    await writeFile(join(dir, 'proj', 's1.jsonl'), `${lines.join('\n')}\nnot json\n`);
    await writeFile(join(dir, 'proj', 's1', 'subagents', 'agent-x.jsonl'), lines.join('\n'));

    const [s, ...rest] = await new TranscriptOverheadSource(dir).read();
    expect(rest).toHaveLength(0);
    expect(s).toMatchObject({
      sessionId: 's1',
      project: 'proj',
      requestTokens: 1500,
      promptTokens: 6,
      toolNames: 3,
      skills: 2,
      instructionFiles: [{ path: '/p/CLAUDE.md', kind: 'Project', tokens: 30 }],
    });
    const p = s?.parts;
    expect(p?.['system-prompt']).toBe(Math.ceil((600 + 1) / 4));
    expect(p?.['mcp-instructions']).toBe(20);
    expect(p?.agents).toBe(7);
    expect(p?.instructions).toBe(30);
    expect(p?.skills).toBe(Math.ceil(`- a: ${text(9)}\n- b`.length / 4));
    expect(p?.session).toBeGreaterThan(0);
    const measured = Object.entries(p ?? {})
      .filter(([k]) => k !== 'unrecorded')
      .reduce((n, [, v]) => n + v, 0);
    expect(p?.unrecorded).toBe(1500 - 6 - measured);
    expect(s?.mcpServers).toEqual([{ server: 'gmail', tools: 2, tokens: 10, example: 'send' }]);
    expect(Object.keys(s?.skillListing ?? {})).toEqual(['a', 'b']);
  });

  it('skips transcripts without a reply and older than the window', async () => {
    await mkdir(join(dir, 'proj'));
    await writeFile(join(dir, 'proj', 'empty.jsonl'), att({ type: 'date', date: 'x' }));
    const source = new TranscriptOverheadSource(dir);
    expect(await source.read()).toEqual([]);
    expect(await source.read(new Date('2030-01-01'))).toEqual([]);
  });
});

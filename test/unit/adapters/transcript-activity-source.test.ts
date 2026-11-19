import { mkdir, mkdtemp, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { TranscriptActivitySource } from '../../../src/adapters/claude/history/transcript-activity-source.js';
import { MemoryLogger } from '../../support/fakes.js';

const at = (min: number) => new Date(Date.UTC(2026, 10, 19, 10, min)).toISOString();
const prompt = (uuid: string, min: number, extra: Record<string, unknown> = {}) =>
  JSON.stringify({
    type: 'user',
    uuid,
    sessionId: 's1',
    timestamp: at(min),
    isSidechain: false,
    origin: { kind: 'human' },
    message: { role: 'user', content: 'do the thing' },
    ...extra,
  });
const compaction = (uuid: string, min: number, trigger: string, preTokens?: number) =>
  JSON.stringify({
    type: 'system',
    subtype: 'compact_boundary',
    uuid,
    sessionId: 's1',
    timestamp: at(min),
    compactMetadata: { trigger, ...(preTokens === undefined ? {} : { preTokens }) },
  });

describe('TranscriptActivitySource', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'cclens-activity-'));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  async function write(rel: string, lines: string[]): Promise<string> {
    const path = join(dir, rel);
    await mkdir(join(path, '..'), { recursive: true });
    await writeFile(path, `${lines.join('\n')}\n`);
    return path;
  }

  it('counts human prompts and compactions per session, skipping noise', async () => {
    await write('-Users-me-site/s1.jsonl', [
      prompt('u1', 1),
      prompt('u1', 1), // duplicate line
      prompt('u2', 2, { origin: { kind: 'task-notification' } }),
      prompt('u3', 3, { isMeta: true }),
      prompt('u4', 4, { isCompactSummary: true }),
      prompt('u5', 5, { isSidechain: true }),
      JSON.stringify({
        type: 'user',
        uuid: 'u6',
        sessionId: 's1',
        timestamp: at(6),
        message: { content: [{ type: 'tool_result', tool_use_id: 't1', content: 'big' }] },
      }),
      // Older transcripts have no `origin`: plain text counts, command wrappers do not.
      JSON.stringify({
        type: 'user',
        uuid: 'u7',
        sessionId: 's1',
        timestamp: at(7),
        message: { content: 'hi' },
      }),
      JSON.stringify({
        type: 'user',
        uuid: 'u8',
        sessionId: 's1',
        timestamp: at(8),
        message: { content: '<local-command-stdout>x' },
      }),
      compaction('c1', 9, 'auto', 300_000),
      compaction('c2', 10, 'auto', 500_000),
      compaction('c3', 11, 'manual'),
      '{"type":"user" broken',
      JSON.stringify({ type: 'assistant', uuid: 'a1', sessionId: 's1', timestamp: at(12) }),
      JSON.stringify({ type: 'user', uuid: 'u9', timestamp: at(13), origin: { kind: 'human' } }),
    ]);
    await write('-Users-me-site/s1/subagents/agent-a.jsonl', [prompt('sub1', 14)]);

    const logger = new MemoryLogger();
    const [s, ...rest] = await new TranscriptActivitySource(dir, logger).read();
    expect(rest).toHaveLength(0);
    expect(s).toEqual({
      sessionId: 's1',
      project: '-Users-me-site',
      firstActivity: new Date(at(1)),
      lastActivity: new Date(at(11)),
      prompts: 2,
      autoCompactions: 2,
      manualCompactions: 1,
      peakContextTokens: 500_000,
      title: { text: 'do the thing', source: 'first-prompt' },
    });
    expect(logger.entries.some((e) => e.message.includes('unreadable'))).toBe(true);
  });

  it('honours `since` for lines and skips files not modified since', async () => {
    await write('-p/s1.jsonl', [prompt('u1', 1), prompt('u2', 30)]);
    const old = await write('-p/old.jsonl', [prompt('o1', 40, { sessionId: 'old' })]);
    const past = new Date('2026-01-01T00:00:00Z');
    await utimes(old, past, past);

    const list = await new TranscriptActivitySource(dir).read(new Date(at(20)));
    expect(list.map((a) => [a.sessionId, a.prompts])).toEqual([['s1', 1]]);
    expect(list[0]).not.toHaveProperty('peakContextTokens');
  });

  it('names sessions by their last custom title, else the first typed prompt', async () => {
    const title = (text: string, sessionId = 's1') =>
      JSON.stringify({ type: 'custom-title', customTitle: text, sessionId });
    await write('-p/s1.jsonl', [
      title('Old name'),
      prompt('u1', 2, { message: { content: 'second prompt' } }),
      prompt('u0', 1, { message: { content: [{ type: 'text', text: '  first\n prompt ' }] } }),
      title('  Website   UI review  '),
      '{"type":"custom-title","customTitle":42}',
    ]);
    await write('-p/s2.jsonl', [
      prompt('v1', 1, {
        sessionId: 's2',
        message: {
          content:
            '<command-message>write-article</command-message>\n<command-name>/write-article</command-name>\n<command-args>caching</command-args>',
        },
      }),
    ]);
    await write('-p/s3.jsonl', [
      prompt('w1', 1, { sessionId: 's3', message: { content: '<system-reminder>x' } }),
    ]);
    const byId = new Map(
      (await new TranscriptActivitySource(dir).read()).map((a) => [a.sessionId, a.title]),
    );
    expect(byId.get('s1')).toEqual({ text: 'Website UI review', source: 'custom' });
    expect(byId.get('s2')).toEqual({ text: '/write-article caching', source: 'first-prompt' });
    expect(byId.get('s3')).toBeUndefined();
  });

  it('registers scheduled sessions that have a title but no typed prompt', async () => {
    await write('-p/sched.jsonl', [
      JSON.stringify({ type: 'custom-title', customTitle: 'Daily episode', sessionId: 'sched' }),
      prompt('t1', 1, {
        sessionId: 'sched',
        origin: { kind: 'task-notification', subkind: 'scheduled-trigger' },
        message: { content: 'run the daily job' },
      }),
    ]);
    const [s] = await new TranscriptActivitySource(dir).read();
    expect(s).toMatchObject({
      sessionId: 'sched',
      prompts: 0,
      title: { text: 'Daily episode', source: 'custom' },
    });
  });

  it('returns nothing for a missing folder', async () => {
    expect(await new TranscriptActivitySource(join(dir, 'missing')).read()).toEqual([]);
  });
});

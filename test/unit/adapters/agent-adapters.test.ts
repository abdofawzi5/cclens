import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  AgentDirSource,
  PluginAgentSource,
} from '../../../src/adapters/claude/agents/agent-sources.js';
import { TranscriptAgentSource } from '../../../src/adapters/claude/history/agent-activity-source.js';
import {
  LiteLlmPriceList,
  lookupPrice,
  parsePriceList,
} from '../../../src/adapters/pricing/litellm-price-list.js';
import { CompositeAgentSource } from '../../../src/app/inventory/composite-agent-source.js';
import { FakeHttp, json, MemoryCache } from '../../support/fake-http.js';

const SESSION = 'sess-1111';
const jsonl = (rows: unknown[]) => rows.map((r) => JSON.stringify(r)).join('\n') + '\n';

const assistantUse = (id: string, type: string | undefined, at: string) => ({
  type: 'assistant',
  timestamp: at,
  sessionId: SESSION,
  message: {
    role: 'assistant',
    content: [
      {
        type: 'tool_use',
        id,
        name: 'Agent',
        input: {
          description: 'd',
          prompt: 'secret prompt',
          ...(type ? { subagent_type: type } : {}),
        },
      },
    ],
  },
});
const launchedResult = (toolUseId: string, agentId: string, at: string) => ({
  type: 'user',
  timestamp: at,
  sessionId: SESSION,
  message: {
    role: 'user',
    content: [{ type: 'tool_result', tool_use_id: toolUseId, content: 'ok' }],
  },
  toolUseResult: { agentId, status: 'async_launched' },
});
const reply = (msgId: string, req: string, model: string, usage: object, at: string) => ({
  type: 'assistant',
  isSidechain: true,
  timestamp: at,
  sessionId: SESSION,
  requestId: req,
  message: { id: msgId, model, usage, content: [] },
});

describe('TranscriptAgentSource', () => {
  let dir: string;

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'cclens-agents-'));
    const project = join(dir, '-Users-me-site');
    const runs = join(project, SESSION, 'subagents');
    await mkdir(runs, { recursive: true });
    await writeFile(
      join(project, `${SESSION}.jsonl`),
      jsonl([
        assistantUse('tu-1', 'pr-review:code-reviewer', '2026-11-18T10:00:00Z'),
        launchedResult('tu-1', 'aaa', '2026-11-18T10:00:01Z'),
        assistantUse('tu-2', undefined, '2026-11-18T11:00:00Z'),
        launchedResult('tu-2', 'bbb', '2026-11-18T11:00:01Z'),
        assistantUse('tu-3', 'missing-agent', '2026-11-18T12:00:00Z'),
        assistantUse('tu-old', 'Explore', '2026-10-01T12:00:00Z'),
        'not json',
      ]),
    );
    // Run aaa: type from the launching call; a streamed response counted once; synthetic skipped.
    await writeFile(
      join(runs, 'agent-aaa.jsonl'),
      jsonl([
        { type: 'user', isSidechain: true, timestamp: '2026-11-18T10:00:02Z', sessionId: SESSION },
        reply(
          'm1',
          'r1',
          'claude-haiku-5-5',
          { input_tokens: 100, output_tokens: 10, cache_read_input_tokens: 1000 },
          '2026-11-18T10:00:05Z',
        ),
        reply(
          'm1',
          'r1',
          'claude-haiku-5-5',
          { input_tokens: 100, output_tokens: 10, cache_read_input_tokens: 1000 },
          '2026-11-18T10:00:06Z',
        ),
        reply(
          'm2',
          'r2',
          'claude-opus-5-5',
          { input_tokens: 5, output_tokens: 5, cache_creation_input_tokens: 50 },
          '2026-11-18T10:01:00Z',
        ),
        reply('m3', 'r3', '<synthetic>', { input_tokens: 999 }, '2026-11-18T10:02:00Z'),
      ]),
    );
    // Run bbb: type from its meta file, which wins over the call.
    await writeFile(
      join(runs, 'agent-bbb.jsonl'),
      jsonl([
        reply(
          'm9',
          'r9',
          'claude-opus-5-5',
          { input_tokens: 1, output_tokens: 2 },
          '2026-11-18T11:00:05Z',
        ),
      ]),
    );
    await writeFile(join(runs, 'agent-bbb.meta.json'), JSON.stringify({ agentType: 'Explore' }));
    await writeFile(join(runs, 'agent-bbb.prefix.json'), '{}');
    // Run ccc: no meta and no call → unknown.
    await writeFile(
      join(runs, 'agent-ccc.jsonl'),
      jsonl([reply('m8', 'r8', 'claude-opus-5-5', { output_tokens: 7 }, '2026-11-18T13:00:00Z')]),
    );
  });

  afterAll(() => rm(dir, { recursive: true, force: true }));

  it('reads runs with tokens per model and their agent types', async () => {
    const { runs, calls } = await new TranscriptAgentSource(dir).read();
    expect(runs.map((r) => [r.agentId, r.agentType, r.sessionId, r.project])).toEqual([
      ['aaa', 'pr-review:code-reviewer', SESSION, '-Users-me-site'],
      ['bbb', 'Explore', SESSION, '-Users-me-site'],
      ['ccc', 'unknown', SESSION, '-Users-me-site'],
    ]);
    const aaa = runs[0];
    expect(aaa?.byModel).toEqual([
      {
        model: 'claude-haiku-5-5',
        counts: { input: 100, output: 10, cacheCreation: 0, cacheRead: 1000 },
      },
      {
        model: 'claude-opus-5-5',
        counts: { input: 5, output: 5, cacheCreation: 50, cacheRead: 0 },
      },
    ]);
    expect(aaa?.counts).toEqual({ input: 105, output: 15, cacheCreation: 50, cacheRead: 1000 });
    expect(aaa?.start.toISOString()).toBe('2026-11-18T10:00:02.000Z');
    expect(aaa?.end.toISOString()).toBe('2026-11-18T10:02:00.000Z');
    expect(Object.fromEntries(calls)).toEqual({
      'pr-review:code-reviewer': 1,
      'general-purpose': 1,
      'missing-agent': 1,
      Explore: 1,
    });
  });

  it('counts only calls and runs inside the window', async () => {
    const { runs, calls } = await new TranscriptAgentSource(dir).read(
      new Date('2026-11-18T10:30:00Z'),
    );
    expect(runs.map((r) => r.agentId)).toEqual(['bbb', 'ccc']);
    expect(calls.get('Explore')).toBeUndefined();
    expect(calls.get('pr-review:code-reviewer')).toBeUndefined();
    expect(calls.get('general-purpose')).toBe(1);
  });

  it('returns nothing for a missing folder', async () => {
    const { runs, calls } = await new TranscriptAgentSource(join(dir, 'nope')).read();
    expect(runs).toEqual([]);
    expect(calls.size).toBe(0);
  });
});

describe('agent inventory', () => {
  let dir: string;

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'cclens-agent-inv-'));
    await mkdir(join(dir, 'personal'), { recursive: true });
    await writeFile(
      join(dir, 'personal', 'reviewer.md'),
      '---\nname: reviewer\ndescription: Reviews\n  code carefully\nmodel: haiku\n---\nBody',
    );
    await writeFile(join(dir, 'personal', 'plain.md'), 'No front matter');
    await writeFile(join(dir, 'personal', 'notes.txt'), 'ignored');
    const plugin = join(dir, 'plugins', 'cache', 'mkt', 'toolkit');
    await mkdir(join(plugin, '.claude-plugin'), { recursive: true });
    await mkdir(join(plugin, 'agents'), { recursive: true });
    await writeFile(
      join(plugin, '.claude-plugin', 'plugin.json'),
      JSON.stringify({ name: 'toolkit' }),
    );
    await writeFile(join(plugin, 'agents', 'hunter.md'), '---\ndescription: Finds bugs\n---\n');
  });

  afterAll(() => rm(dir, { recursive: true, force: true }));

  it('reads personal agents with name, description and model', async () => {
    const agents = await new AgentDirSource('personal', join(dir, 'personal'), 'personal').list();
    expect(agents).toEqual([
      { id: 'plain', name: 'plain', scope: 'personal', path: join(dir, 'personal', 'plain.md') },
      {
        id: 'reviewer',
        name: 'reviewer',
        scope: 'personal',
        path: join(dir, 'personal', 'reviewer.md'),
        description: 'Reviews code carefully',
        model: 'haiku',
      },
    ]);
    expect(await new AgentDirSource('x', join(dir, 'none'), 'project').list()).toEqual([]);
  });

  it('reads plugin agents as plugin:name and merges sources', async () => {
    const plugin = await new PluginAgentSource([join(dir, 'plugins')]).list();
    expect(plugin.map((a) => [a.id, a.plugin, a.description])).toEqual([
      ['toolkit:hunter', 'toolkit', 'Finds bugs'],
    ]);
    const all = await new CompositeAgentSource([
      new AgentDirSource('personal', join(dir, 'personal'), 'personal'),
      new PluginAgentSource([join(dir, 'plugins')]),
      new AgentDirSource('again', join(dir, 'personal'), 'project'),
    ]).list();
    expect(all.map((a) => a.id)).toEqual(['plain', 'reviewer', 'toolkit:hunter']);
  });
});

describe('LiteLLM prices', () => {
  const raw = {
    'claude-opus-5-5': {
      input_cost_per_token: 5e-6,
      output_cost_per_token: 25e-6,
      cache_creation_input_token_cost: 6.25e-6,
      cache_read_input_token_cost: 0.5e-6,
    },
    'anthropic/claude-haiku-5-5': { input_cost_per_token: 1e-6, output_cost_per_token: 5e-6 },
    'gpt-9': { input_cost_per_token: 1, output_cost_per_token: 1 },
    'claude-broken': { input_cost_per_token: 'free' },
    'claude-no-output': { input_cost_per_token: 1e-6 },
  };

  it('keeps Claude models and fills missing cache prices', () => {
    const prices = parsePriceList(raw);
    expect(Object.keys(prices)).toEqual(['claude-opus-5-5', 'anthropic/claude-haiku-5-5']);
    const haiku = prices['anthropic/claude-haiku-5-5'];
    expect(haiku?.input).toBe(1e-6);
    expect(haiku?.output).toBe(5e-6);
    expect(haiku?.cacheCreation).toBeCloseTo(1.25e-6, 12);
    expect(haiku?.cacheRead).toBeCloseTo(1e-7, 12);
    expect(parsePriceList(null)).toEqual({});
  });

  it('looks models up by exact, provider-prefixed and undated name', () => {
    const prices = parsePriceList(raw);
    expect(lookupPrice(prices, 'claude-opus-5-5')?.output).toBe(25e-6);
    expect(lookupPrice(prices, 'claude-haiku-5-5')?.input).toBe(1e-6);
    expect(lookupPrice(prices, 'claude-opus-5-5-20261101')?.input).toBe(5e-6);
    expect(lookupPrice(prices, 'claude-unknown')).toBeUndefined();
  });

  it('downloads once, then serves from the cache', async () => {
    const http = new FakeHttp().route(/litellm/, json(raw));
    const cache = new MemoryCache();
    const table = await new LiteLlmPriceList(http, cache).load();
    expect(table.price('claude-opus-5-5')?.input).toBe(5e-6);
    const again = await new LiteLlmPriceList(http, cache).load();
    expect(again.price('claude-haiku-5-5')?.output).toBe(5e-6);
    expect(http.calls).toHaveLength(1);
    expect(http.calls[0]?.headers).toEqual({});
  });

  it('fails clearly when the list cannot be used', async () => {
    await expect(
      new LiteLlmPriceList(
        new FakeHttp().route(/litellm/, json({}, 500)),
        new MemoryCache(),
      ).load(),
    ).rejects.toThrow('HTTP 500');
    await expect(
      new LiteLlmPriceList(
        new FakeHttp().route(/litellm/, json({ 'gpt-9': {} })),
        new MemoryCache(),
      ).load(),
    ).rejects.toThrow('no Claude models');
  });
});

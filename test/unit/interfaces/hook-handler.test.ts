import { PassThrough } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { UsageService } from '../../../src/app/usage-service.js';
import {
  HookHandler,
  hookOutput,
  toRecordInput,
} from '../../../src/interfaces/hook/hook-handler.js';
import { readStdin } from '../../../src/interfaces/hook/read-stdin.js';
import { FixedClock, MemoryEventStore, MemoryLogger } from '../../support/fakes.js';

const post = (tool: string, input: unknown): string =>
  JSON.stringify({
    hook_event_name: 'PostToolUse',
    tool_name: tool,
    tool_input: input,
    session_id: 's1',
    cwd: '/Users/x/website',
  });
const prompt = (text: string): string =>
  JSON.stringify({
    hook_event_name: 'UserPromptSubmit',
    prompt: text,
    session_id: 's1',
    cwd: 'C:\\code\\api',
  });

describe('toRecordInput', () => {
  it('maps a Skill tool use and a typed command', () => {
    expect(
      toRecordInput({
        hook_event_name: 'PostToolUse',
        tool_name: 'Skill',
        tool_input: { skill: 'a:b' },
        cwd: '/w/site/',
      }),
    ).toEqual({ skill: 'a:b', source: 'auto', project: 'site' });
    expect(
      toRecordInput({ hook_event_name: 'UserPromptSubmit', prompt: '/write-article x' }),
    ).toEqual({ skill: 'write-article', source: 'typed', project: '' });
  });
});

describe('HookHandler', () => {
  const setup = (): { handler: HookHandler; store: MemoryEventStore; logger: MemoryLogger } => {
    const store = new MemoryEventStore();
    const logger = new MemoryLogger();
    const handler = new HookHandler(new UsageService(store, new FixedClock()), logger);
    return { handler, store, logger };
  };

  it('records skill uses from both events', async () => {
    const { handler, store } = setup();
    expect(await handler.handle(post('Skill', { skill: 'marketing:seo-audit' }))).toEqual({
      kind: 'recorded',
      skill: 'marketing:seo-audit',
    });
    expect(await handler.handle(prompt('/write-article caching'))).toEqual({
      kind: 'recorded',
      skill: 'write-article',
    });
    expect(store.events.map((e) => [e.source, e.skill, e.project, e.sessionId])).toEqual([
      ['auto', 'marketing:seo-audit', 'website', 's1'],
      ['typed', 'write-article', 'api', 's1'],
    ]);
  });

  it.each([
    [post('Bash', { command: 'ls' }), 'not a skill use'],
    [post('Skill', {}), 'not a skill use'],
    [prompt('hello'), 'not a skill use'],
    [prompt('/compact'), 'not a skill use'],
    [JSON.stringify({ hook_event_name: 'Stop' }), 'unsupported hook event'],
  ])('ignores %s', async (input, reason) => {
    const { handler, store } = setup();
    expect(await handler.handle(input)).toEqual({ kind: 'ignored', reason });
    expect(store.events).toHaveLength(0);
  });

  it('logs instead of throwing on bad input or storage failure', async () => {
    const { handler, logger, store } = setup();
    expect((await handler.handle('not json')).kind).toBe('error');
    store.append = () => Promise.reject(new Error('disk full'));
    expect(await handler.handle(post('Skill', { skill: 's' }))).toEqual({
      kind: 'error',
      reason: 'disk full',
    });
    expect(logger.entries.map((e) => e.level)).toEqual(['error', 'error']);
  });
});

describe('readStdin', () => {
  it('reads until end', async () => {
    const s = new PassThrough();
    const p = readStdin(s);
    s.write('{"a":');
    s.end('1}');
    expect(await p).toBe('{"a":1}');
  });

  it('gives up after the timeout', async () => {
    const s = new PassThrough();
    s.write('partial');
    expect(await readStdin(s, 20)).toBe('partial');
  });
});

describe('HookHandler budget warning', () => {
  const make = (warning: () => Promise<string | undefined>) => {
    const logger = new MemoryLogger();
    const usage = new UsageService(new MemoryEventStore(), new FixedClock());
    return { handler: new HookHandler(usage, logger, warning), logger };
  };

  it('adds the warning on UserPromptSubmit only', async () => {
    let calls = 0;
    const { handler } = make(() => {
      calls++;
      return Promise.resolve('cclens: over');
    });
    expect(await handler.handle(prompt('hello'))).toEqual({
      kind: 'ignored',
      reason: 'not a skill use',
      warning: 'cclens: over',
    });
    expect((await handler.handle(post('Skill', { skill: 's' }))).warning).toBeUndefined();
    expect(calls).toBe(1);
  });

  it('logs and drops a failing budget check', async () => {
    const { handler, logger } = make(() => Promise.reject(new Error('boom')));
    expect(await handler.handle(prompt('/write-article x'))).toEqual({
      kind: 'recorded',
      skill: 'write-article',
    });
    expect(logger.entries[0]?.message).toBe('budget check failed');
  });

  it('formats Claude Code hook JSON', () => {
    expect(JSON.parse(hookOutput('cclens: over'))).toEqual({
      systemMessage: 'cclens: over',
      hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: 'cclens: over' },
    });
  });
});

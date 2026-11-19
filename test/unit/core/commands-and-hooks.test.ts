import { describe, expect, it } from 'vitest';
import { extractTypedCommand } from '../../../src/core/domain/commands.js';
import {
  cclensHookSpecs,
  isCclensHookCommand,
  isLegacyHookCommand,
} from '../../../src/core/domain/hooks.js';
import { usageEventKey } from '../../../src/core/domain/usage-event.js';

describe('extractTypedCommand', () => {
  it.each([
    ['/write-article about caching', 'write-article'],
    ['  /marketing:seo-audit', 'marketing:seo-audit'],
    ['/write-article', 'write-article'],
    ['<command-name>/remotion:remotion-render</command-name>', 'remotion:remotion-render'],
    ['<command-name>write-article</command-name>', 'write-article'],
  ])('%s -> %s', (text, expected) => {
    expect(extractTypedCommand(text)).toBe(expected);
  });

  it.each([
    'hello',
    '/compact',
    '/Clear',
    'use /write-article later',
    '<command-name>/usage</command-name>',
    '/',
  ])('ignores %s', (text) => {
    expect(extractTypedCommand(text)).toBeUndefined();
  });
});

describe('hook specs', () => {
  it('builds marked hooks for both events', () => {
    const specs = cclensHookSpecs('"/node" "/cli.js"');
    expect(specs).toEqual([
      { event: 'PostToolUse', matcher: 'Skill', command: 'CCLENS_HOOK=1 "/node" "/cli.js" hook' },
      { event: 'UserPromptSubmit', command: 'CCLENS_HOOK=1 "/node" "/cli.js" hook' },
    ]);
    expect(specs.every((s) => isCclensHookCommand(s.command))).toBe(true);
  });

  it('recognises legacy and foreign hooks', () => {
    expect(isLegacyHookCommand('~/.claude/hooks/log-skill-usage.sh')).toBe(true);
    expect(isCclensHookCommand('~/.claude/hooks/log-skill-usage.sh')).toBe(false);
  });

  it('builds stable event keys', () => {
    expect(
      usageEventKey({
        v: 1,
        ts: new Date('2026-01-01T00:00:00Z'),
        source: 'auto',
        skill: 's',
        project: 'p',
      }),
    ).toBe('2026-01-01T00:00:00.000Z|s|');
  });
});

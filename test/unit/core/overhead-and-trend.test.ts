import { describe, expect, it } from 'vitest';
import { fixHints, pluginKeyFromPath } from '../../../src/core/domain/fix-hints.js';
import {
  latestSkillListing,
  mcpServerOf,
  overheadTokens,
  parseSkillListing,
  type SessionOverhead,
  summarizeOverhead,
  withUnrecorded,
} from '../../../src/core/domain/overhead.js';
import { change, costPerPrompt, windowStats } from '../../../src/core/domain/trend.js';
import { activity, day } from '../../support/review.js';

const overhead = (
  at: string,
  measured: Parameters<typeof withUnrecorded>[2],
  requestTokens = 1000,
  extra: Partial<SessionOverhead> = {},
): SessionOverhead => ({
  sessionId: at,
  project: 'p',
  at: new Date(at),
  requestTokens,
  promptTokens: 10,
  parts: withUnrecorded(requestTokens, 10, measured),
  toolNames: 0,
  mcpServers: [],
  instructionFiles: [],
  ...extra,
});

describe('context overhead', () => {
  it('puts what the transcript does not record in "the rest", never below zero', () => {
    const s = overhead('2026-11-19T10:00:00Z', { skills: 300, 'system-prompt': 200 });
    expect(s.parts.unrecorded).toBe(490);
    expect(overheadTokens(s)).toBe(990);
    expect(withUnrecorded(100, 10, { skills: 500 }).unrecorded).toBe(0);
  });

  it('averages parts over sessions, largest first, and keeps the latest', () => {
    const a = overhead('2026-11-18T10:00:00Z', { skills: 400 });
    const b = overhead('2026-11-19T10:00:00Z', { skills: 200, agents: 90 }, 1100);
    const s = summarizeOverhead([b, a]);
    expect(s.sessions).toBe(2);
    expect(s.averageTokens).toBe(1040);
    expect(s.parts.map((p) => [p.part, p.tokens])).toEqual([
      ['unrecorded', 695],
      ['skills', 300],
      ['agents', 45],
    ]);
    expect(s.latest).toBe(b);
    expect(summarizeOverhead([])).toEqual({ sessions: 0, averageTokens: 0, parts: [] });
  });

  it('reads MCP server keys from tool names', () => {
    expect(mcpServerOf('mcp__plugin_x_gmail__send_email')).toBe('plugin_x_gmail');
    expect(mcpServerOf('mcp__1a59c906-04da__create')).toBe('1a59c906-04da');
    expect(mcpServerOf('WebSearch')).toBeUndefined();
  });

  it('splits the skill listing per skill and finds the latest one', () => {
    const listing = parseSkillListing('- write-article: Write a blog post\n- a:b\n- c:d: x: y');
    expect(Object.keys(listing)).toEqual(['write-article', 'a:b', 'c:d']);
    expect(listing['a:b']).toBe(2);
    expect(listing['write-article']).toBe(
      Math.ceil(('write-article: Write a blog post'.length + 3) / 4),
    );
    expect(parseSkillListing('')).toEqual({});
    const older = overhead('2026-11-18T10:00:00Z', {}, 1000, { skillListing: { x: 1 } });
    const newer = overhead('2026-11-19T10:00:00Z', {}, 1000, { skillListing: { y: 2 } });
    const none = overhead('2026-11-20T10:00:00Z', {});
    expect(latestSkillListing([newer, none, older])).toEqual({ y: 2 });
  });
});

describe('fix hints', () => {
  const home = '/Users/me/.claude';
  it('derives plugin ids from install paths', () => {
    expect(
      pluginKeyFromPath(`${home}/plugins/cache/acme/tools/1.0.0/skills/a/SKILL.md`, 'tools', home),
    ).toBe('tools@acme');
    expect(
      pluginKeyFromPath(`${home}/plugins/synced/x_y/123/skills/a/SKILL.md`, 'design', home),
    ).toBe('design@synced');
    expect(pluginKeyFromPath('/elsewhere/skills/a/SKILL.md', 'x', home)).toBeUndefined();
  });

  it('prints a command where one works and a note elsewhere, biggest first', () => {
    const hints = fixHints(
      [
        {
          plugin: 'small',
          skills: 1,
          tokens: 5,
          path: `${home}/plugins/cache/m/small/1/s/SKILL.md`,
        },
        { plugin: 'enabled', skills: 2, tokens: 50 },
        { plugin: 'design', skills: 3, tokens: 40, path: `${home}/plugins/synced/a/b/s/SKILL.md` },
        { plugin: 'desktop', skills: 4, tokens: 30, path: '/Users/me/Library/Claude/p/SKILL.md' },
        { skillId: 'mine', skills: 1, tokens: 20, path: `${home}/skills/mine/SKILL.md` },
      ],
      [{ key: 'enabled@market', scope: 'project' }],
      home,
    );
    expect(hints.map((h) => (h.kind === 'command' ? h.command : h.note))).toEqual([
      'claude plugin disable enabled@market --scope project',
      'claude plugin disable design@synced',
      'installed by the Claude desktop app: turn it off in the app’s plugin settings',
      `standalone skill: move ${home}/skills/mine out of your skills folder to stop listing it`,
      'claude plugin disable small@m',
    ]);
    expect(hints[1]).toMatchObject({ note: 'synced from your claude.ai account' });
  });
});

describe('window comparison', () => {
  it('totals each window and counts a session in the window it ended in', () => {
    const since = new Date(2026, 10, 10);
    const until = new Date(2026, 10, 13);
    const daily = [
      day('2026-11-09', { input: 100 }),
      day('2026-11-10', { input: 60, cacheRead: 40 }),
      day('2026-11-12', { input: 100 }),
      day('2026-11-13', { input: 999 }),
    ];
    const sessions = [
      activity('in', { lastActivity: new Date(2026, 10, 11), prompts: 4, autoCompactions: 1 }),
      activity('before', { lastActivity: new Date(2026, 10, 9), prompts: 9 }),
      activity('after', { lastActivity: new Date(2026, 10, 13), prompts: 9 }),
    ];
    const s = windowStats(since, until, daily, sessions);
    expect(s).toMatchObject({
      costUsd: 2,
      totalTokens: 200,
      sessions: 1,
      prompts: 4,
      autoCompactions: 1,
      cacheReadShare: 0.2,
    });
    expect(costPerPrompt(s)).toBe(0.5);
    expect(costPerPrompt({ ...s, prompts: 0 })).toBeUndefined();
    expect(change(4, 5)).toBe(0.25);
    expect(change(0, 5)).toBeUndefined();
  });
});

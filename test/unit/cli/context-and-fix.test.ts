import { stripVTControlCharacters as strip } from 'node:util';
import { describe, expect, it } from 'vitest';
import { InventoryService } from '../../../src/app/inventory/inventory-service.js';
import { UsageService } from '../../../src/app/usage-service.js';
import { resolvePaths } from '../../../src/adapters/system/paths.js';
import { createContainer } from '../../../src/composition-root.js';
import { type SessionOverhead, withUnrecorded } from '../../../src/core/domain/overhead.js';
import type { Skill } from '../../../src/core/domain/skill.js';
import { buildProgram } from '../../../src/interfaces/cli/program.js';
import { serverLabel } from '../../../src/interfaces/cli/commands/context-command.js';
import { renderFixHints } from '../../../src/interfaces/cli/commands/skills-command.js';
import { event, FixedClock, MemoryEventStore } from '../../support/fakes.js';
import { FakeTokens } from '../../support/fake-tokens.js';
import { InMemoryConfigStore } from '../../support/in-memory-config-store.js';
import { activity } from '../../support/review.js';

const home = '/Users/me/.claude';
const session: SessionOverhead = {
  sessionId: 's1',
  project: 'p',
  at: new Date('2026-11-19T09:00:00Z'),
  requestTokens: 20_000,
  promptTokens: 100,
  parts: withUnrecorded(20_000, 100, { skills: 3000, 'tool-names': 900, instructions: 400 }),
  toolNames: 40,
  mcpServers: [
    { server: '1a59c906-04da-521d-bda7-7f71b9f9e01c', tools: 30, tokens: 600, example: 'create' },
    { server: 'plugin_biz_gmail', tools: 10, tokens: 300, example: 'send' },
  ],
  instructionFiles: [{ path: '/Users/me/proj/CLAUDE.md', kind: 'Project', tokens: 400 }],
  skills: 3,
  skillListing: { 'social:a': 1200, 'social:b': 800, 'write-article': 50 },
};

const skills: Skill[] = [
  {
    id: 'social:a',
    name: 'a',
    scope: 'plugin',
    plugin: 'social',
    path: `${home}/plugins/synced/x/y/skills/a/SKILL.md`,
  },
  { id: 'social:b', name: 'b', scope: 'plugin', plugin: 'social' },
  { id: 'mkt:seo', name: 'seo', scope: 'plugin', plugin: 'mkt' },
  {
    id: 'write-article',
    name: 'write-article',
    scope: 'personal',
    path: `${home}/skills/write-article/SKILL.md`,
  },
];

async function run(args: string[]): Promise<string> {
  const events = new MemoryEventStore();
  events.events.push(event('mkt:seo', '2026-11-18T00:00:00Z'));
  const container = createContainer({
    overrides: {
      paths: resolvePaths({}, '/Users/me'),
      clock: new FixedClock(),
      configStore: new InMemoryConfigStore(),
      eventStore: events,
      tokens: new FakeTokens(),
      skillSource: { id: 'fake', list: () => Promise.resolve(skills) },
      activitySource: { read: () => Promise.resolve([activity('s1')]) },
      overhead: { read: () => Promise.resolve([session]) },
    },
  });
  const lines: string[] = [];
  await buildProgram(container, '1.0.0', (t) => lines.push(t))
    .exitOverride()
    .parseAsync(['node', 'cclens', ...args]);
  return strip(lines.join('\n'));
}

describe('context command', () => {
  it('shows the parts, MCP servers and instruction files', async () => {
    const out = await run(['context']);
    expect(out).toContain(
      'Before your first prompt, Claude Code sends 19.9K tokens in the latest session.',
    );
    expect(out).toMatch(/Tool definitions and the rest\s+│\s+~15\.6K │\s+78%/);
    expect(out).toMatch(/Skill listing\s+│\s+~3\.0K │\s+15% │ 3 skills/);
    expect(out).toMatch(/Deferred tool names .* 40 tools, 40 from 2 MCP servers/);
    expect(out).toContain('claude.ai connector 1a59c906');
    expect(out).toContain('~/proj/CLAUDE.md');
    const json = JSON.parse(await run(['--json', 'context'])) as { sessions: number };
    expect(json.sessions).toBe(1);
  });

  it('labels servers', () => {
    expect(serverLabel('plugin_biz_gmail')).toBe('plugin biz_gmail');
    expect(serverLabel('easel')).toBe('easel');
  });
});

describe('skills --fix', () => {
  it('prints commands and notes for unused plugins and skills, sized by the real listing', async () => {
    const out = await run(['skills', '--unused', '--by-plugin', '--fix']);
    expect(out).toContain('Unused: 1 plugins and 1 standalone skills, ~2.0K listing tokens');
    expect(out).toContain('claude plugin disable social@synced  # 2 skills, ~2.0K tokens; synced');
    expect(out).toContain('write-article (1 skill, ~50 tokens): standalone skill: move');
    expect(out).not.toContain('mkt');
  });

  it('works without settings or a listing, and says when nothing is unused', async () => {
    const usage = new UsageService(new MemoryEventStore(), new FixedClock());
    const svc = new InventoryService(
      { id: 'f', list: () => Promise.resolve(skills.slice(2, 3)) },
      usage,
    );
    const hints = await svc.fixHints();
    expect(hints).toHaveLength(1);
    expect(hints[0]?.kind).toBe('manual');
    expect(renderFixHints([], '')).toContain('Nothing to turn off');
  });
});

describe('review --compare', () => {
  it('prints the before and now table', async () => {
    const out = await run(['review', '--compare', '--days', '1']);
    expect(out).toMatch(/Compared with 2026-11-18 to 2026-11-18/);
    expect(out).toMatch(/Estimated cost\s+\$1\.00\s+\$2\.00\s+\+100%/);
    expect(out).toMatch(/Sessions\s+0\s+1\s+new/);
  });
});

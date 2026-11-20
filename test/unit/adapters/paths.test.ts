import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { hookDirArgs, resolvePaths } from '../../../src/adapters/system/paths.js';

describe('resolvePaths', () => {
  it('defaults under the home directory', () => {
    const p = resolvePaths({}, '/home/u');
    expect(p.home).toBe(join('/home/u', '.cclens'));
    expect(p.eventsFile).toBe(join('/home/u', '.cclens', 'events.jsonl'));
    expect(p.claudeProjectsDir).toBe(join('/home/u', '.claude', 'projects'));
    expect(p.legacyUsageLog).toBe(join('/home/u', '.claude', 'skill-usage.log'));
  });

  it('honours CCLENS_HOME and CLAUDE_CONFIG_DIR', () => {
    const p = resolvePaths(
      { CCLENS_HOME: '/data/cl', CLAUDE_CONFIG_DIR: '/cfg/claude' },
      '/home/u',
    );
    expect(p.configFile).toBe(join('/data/cl', 'config.json'));
    expect(p.claudeSkillsDir).toBe(join('/cfg/claude', 'skills'));
  });

  it('also scans the desktop app plugins when no Claude dir was chosen', () => {
    const p = resolvePaths({ CLAUDE_CONFIG_DIR: '/cfg/claude' }, '/home/u');
    expect(p.pluginRoots).toHaveLength(2);
    expect(p.pluginRoots[0]).toBe(join('/cfg/claude', 'plugins'));
  });

  it('reads only the chosen dir with CCLENS_CLAUDE_DIR, ahead of CLAUDE_CONFIG_DIR', () => {
    const p = resolvePaths(
      { CCLENS_CLAUDE_DIR: '/work/.claude', CLAUDE_CONFIG_DIR: '/cfg/claude' },
      '/home/u',
    );
    expect(p.claudeHome).toBe('/work/.claude');
    expect(p.claudeProjectsDir).toBe(join('/work/.claude', 'projects'));
    expect(p.pluginRoots).toEqual([join('/work/.claude', 'plugins')]);
  });
});

describe('hookDirArgs', () => {
  it('adds nothing for the default environment', () => {
    expect(hookDirArgs({ CLAUDE_CONFIG_DIR: '/cfg/claude' })).toBe('');
  });

  it('carries the chosen dirs, quoted', () => {
    expect(hookDirArgs({ CCLENS_CLAUDE_DIR: '/w/.claude', CCLENS_HOME: '/w/.cclens' })).toBe(
      ' --claude-dir "/w/.claude" --cclens-home "/w/.cclens"',
    );
  });
});

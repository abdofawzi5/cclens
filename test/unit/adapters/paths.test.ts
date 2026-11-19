import { describe, expect, it } from 'vitest';
import { resolvePaths } from '../../../src/adapters/system/paths.js';

describe('resolvePaths', () => {
  it('defaults under the home directory', () => {
    const p = resolvePaths({}, '/home/u');
    expect(p.home).toBe('/home/u/.cclens');
    expect(p.eventsFile).toBe('/home/u/.cclens/events.jsonl');
    expect(p.claudeProjectsDir).toBe('/home/u/.claude/projects');
    expect(p.legacyUsageLog).toBe('/home/u/.claude/skill-usage.log');
  });

  it('honours CCLENS_HOME and CLAUDE_CONFIG_DIR', () => {
    const p = resolvePaths(
      { CCLENS_HOME: '/data/cl', CLAUDE_CONFIG_DIR: '/cfg/claude' },
      '/home/u',
    );
    expect(p.configFile).toBe('/data/cl/config.json');
    expect(p.claudeSkillsDir).toBe('/cfg/claude/skills');
  });
});

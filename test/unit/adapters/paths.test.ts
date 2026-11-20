import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { resolvePaths } from '../../../src/adapters/system/paths.js';

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
});

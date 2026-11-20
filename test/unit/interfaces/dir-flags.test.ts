import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { applyDirFlags, extractDirFlags } from '../../../src/interfaces/cli/dir-flags.js';

const base = ['node', 'cli.js'];

describe('extractDirFlags', () => {
  it('leaves argv alone without the flags', () => {
    expect(extractDirFlags([...base, 'tokens', '--json'])).toEqual({
      argv: [...base, 'tokens', '--json'],
    });
  });

  it('takes both spellings anywhere in argv and strips them', () => {
    const f = extractDirFlags(
      [...base, '--claude-dir', '/w/.claude', 'tokens', '--cclens-home=/w/.cclens', '--json'],
      '/home/u',
    );
    expect(f.argv).toEqual([...base, 'tokens', '--json']);
    expect(f.claudeDir).toBe(resolve('/w/.claude'));
    expect(f.cclensHome).toBe(resolve('/w/.cclens'));
  });

  it('expands ~ against the home directory', () => {
    const f = extractDirFlags([...base, '--claude-dir', '~/.claude-work'], '/home/u');
    expect(f.claudeDir).toBe(resolve('/home/u', '.claude-work'));
  });

  it('stops at --', () => {
    const f = extractDirFlags([...base, 'search', '--', '--claude-dir', 'x']);
    expect(f.claudeDir).toBeUndefined();
    expect(f.argv).toEqual([...base, 'search', '--', '--claude-dir', 'x']);
  });

  it('rejects a flag without a directory', () => {
    expect(() => extractDirFlags([...base, '--claude-dir'])).toThrow(/needs a directory/);
    expect(() => extractDirFlags([...base, '--claude-dir', '--json'])).toThrow();
    expect(() => extractDirFlags([...base, '--cclens-home='])).toThrow();
  });
});

describe('applyDirFlags', () => {
  it('sets the variables paths and ccusage read', () => {
    const env: NodeJS.ProcessEnv = {};
    applyDirFlags({ argv: [], claudeDir: '/w/.claude', cclensHome: '/w/.cclens' }, env);
    expect(env).toEqual({
      CCLENS_CLAUDE_DIR: '/w/.claude',
      CLAUDE_CONFIG_DIR: '/w/.claude',
      CCLENS_HOME: '/w/.cclens',
    });
  });

  it('passes an exported CCLENS_CLAUDE_DIR on to ccusage', () => {
    const env: NodeJS.ProcessEnv = { CCLENS_CLAUDE_DIR: '/w/.claude', CLAUDE_CONFIG_DIR: '/x' };
    applyDirFlags({ argv: [] }, env);
    expect(env['CLAUDE_CONFIG_DIR']).toBe('/w/.claude');
  });

  it('changes nothing without flags', () => {
    const env: NodeJS.ProcessEnv = { CLAUDE_CONFIG_DIR: '/x' };
    applyDirFlags({ argv: [] }, env);
    expect(env).toEqual({ CLAUDE_CONFIG_DIR: '/x' });
  });
});

import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { encodeProjectPath, resolveProject } from '../../../src/core/domain/projects.js';
import { projectQuery } from '../../../src/interfaces/cli/project-query.js';
import { ValidationError } from '../../../src/core/errors.js';

const known = [
  '-Users-me-Workspace-site',
  '-Users-me-V-Workspace-Site',
  '-Users-me-Workspace-cclens',
  '-private-tmp-claude-503--Users-me-Workspace-site-abc-scratchpad',
];

describe('encodeProjectPath', () => {
  it('turns every non-alphanumeric character into a dash', () => {
    expect(encodeProjectPath('/Users/me/my.app_v2')).toBe('-Users-me-my-app-v2');
  });
});

describe('projectQuery', () => {
  it('encodes paths relative to cwd or home', () => {
    // Resolved per platform: on Windows the drive letter is part of the name (C--Users-…).
    const site = encodeProjectPath(resolve('/Users/me/Workspace/site'));
    expect(projectQuery('.', '/Users/me', '/Users/me/Workspace/site')).toBe(site);
    expect(projectQuery('~/Workspace/site', '/Users/me', '/tmp')).toBe(site);
    expect(projectQuery('/Users/me/Workspace/site/', '/Users/me', '/tmp')).toBe(site);
  });

  it('keeps names as typed', () => {
    expect(projectQuery('site', '/Users/me', '/tmp')).toBe('site');
    expect(projectQuery('-Users-me-Workspace-site', '/Users/me', '/tmp')).toBe(
      '-Users-me-Workspace-site',
    );
  });
});

describe('resolveProject', () => {
  it('accepts the full name', () => {
    expect(resolveProject('-Users-me-Workspace-cclens', known)).toBe('-Users-me-Workspace-cclens');
  });

  it('matches the folder name or the shortened name shown in tables', () => {
    expect(resolveProject('cclens', known)).toBe('-Users-me-Workspace-cclens');
    expect(resolveProject('Workspace-site', known)).toBe('-Users-me-Workspace-site');
    expect(resolveProject('V-Workspace-Site', known)).toBe('-Users-me-V-Workspace-Site');
  });

  it('prefers an exact-case match over a case-insensitive one', () => {
    expect(resolveProject('site', known)).toBe('-Users-me-Workspace-site');
    expect(resolveProject('Site', known)).toBe('-Users-me-V-Workspace-Site');
  });

  it('falls back to ignoring case', () => {
    expect(resolveProject('CCLENS', known)).toBe('-Users-me-Workspace-cclens');
  });

  it('names the candidates when several match', () => {
    expect(() => resolveProject('SITE', known)).toThrow(
      /matches 2 projects.*-Users-me-V-Workspace-Site/,
    );
  });

  it('says how to list projects when none match', () => {
    expect(() => resolveProject('nope', known)).toThrow(ValidationError);
    expect(() => resolveProject('nope', known)).toThrow(/cclens tokens project/);
  });
});

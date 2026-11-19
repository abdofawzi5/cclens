import { mkdtemp, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { stableNodePath } from '../../../src/composition-root.js';

describe.skipIf(process.platform === 'win32')('stableNodePath', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'cclens-node-'));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('prefers a PATH symlink that points at the running node binary', async () => {
    await symlink(process.execPath, join(dir, 'node'));
    expect(stableNodePath({ PATH: `/nonexistent:${dir}` })).toBe(join(dir, 'node'));
  });

  it('falls back to execPath when no PATH entry matches', () => {
    expect(stableNodePath({ PATH: '/nonexistent' })).toBe(process.execPath);
    expect(stableNodePath({})).toBe(process.execPath);
  });
});

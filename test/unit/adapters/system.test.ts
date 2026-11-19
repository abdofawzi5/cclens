import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FileLogger } from '../../../src/adapters/system/file-logger.js';
import { SystemClock } from '../../../src/adapters/system/system-clock.js';

describe('SystemClock', () => {
  it('returns the current time', () => {
    const before = Date.now();
    const now = new SystemClock().now().getTime();
    expect(now).toBeGreaterThanOrEqual(before);
    expect(now).toBeLessThanOrEqual(Date.now());
  });
});

describe('FileLogger', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'cclens-log-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('writes warn and error as JSON lines, debug only when verbose', async () => {
    const file = join(dir, 'sub', 'log.jsonl');
    new FileLogger(file).debug('hidden');
    const logger = new FileLogger(file, true);
    logger.debug('d');
    logger.warn('w', { engine: 'github' });
    logger.error('e');
    const lines = (await readFile(file, 'utf8'))
      .trim()
      .split('\n')
      .map((l) => JSON.parse(l) as Record<string, unknown>);
    expect(lines.map((l) => [l['level'], l['message']])).toEqual([
      ['debug', 'd'],
      ['warn', 'w'],
      ['error', 'e'],
    ]);
    expect(lines[1]?.['engine']).toBe('github');
  });

  it('never throws, even when the path cannot be written', () => {
    const logger = new FileLogger('/dev/null/not-a-dir/log.jsonl');
    expect(() => {
      logger.error('ignored');
    }).not.toThrow();
  });
});

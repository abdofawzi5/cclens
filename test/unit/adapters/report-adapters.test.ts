import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { AtomicFileWriter } from '../../../src/adapters/storage/atomic-file-writer.js';
import { ChartJsAsset } from '../../../src/adapters/system/chartjs-asset.js';
import { SystemOpener } from '../../../src/adapters/system/system-opener.js';
import type { ProcessRunner } from '../../../src/core/ports/infrastructure.js';

function runner(exitCode = 0, stderr = '') {
  const calls: { command: string; args: readonly string[] }[] = [];
  const run: ProcessRunner['run'] = (command, args) => {
    calls.push({ command, args });
    return Promise.resolve({ exitCode, stdout: '', stderr });
  };
  return { calls, runner: { run } };
}

describe('SystemOpener', () => {
  it('uses the platform opener', async () => {
    for (const [platform, command, args] of [
      ['darwin', 'open', ['/r.html']],
      ['linux', 'xdg-open', ['/r.html']],
      ['win32', 'cmd', ['/c', 'start', '', '/r.html']],
    ] as const) {
      const r = runner();
      await new SystemOpener(r.runner, platform).open('/r.html');
      expect(r.calls).toEqual([{ command, args }]);
    }
  });

  it('fails with the opener error', async () => {
    await expect(
      new SystemOpener(runner(1, 'no browser').runner, 'linux').open('/r.html'),
    ).rejects.toThrow('Could not open /r.html: no browser');
    await expect(new SystemOpener(runner(3).runner, 'darwin').open('/r.html')).rejects.toThrow(
      'open exited 3',
    );
  });
});

describe('ChartJsAsset', () => {
  it('reads the installed Chart.js UMD build without its source map comment', async () => {
    const asset = new ChartJsAsset();
    const source = await asset.source();
    expect(asset.license).toBe('MIT');
    expect(source).toMatch(/^\/\*!\n \* Chart\.js v4\./);
    expect(source).not.toContain('sourceMappingURL');
    expect(await asset.source()).toBe(source);
  });

  it('strips a trailing source map line from any file', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'cclens-asset-'));
    try {
      const file = join(dir, 'lib.js');
      await writeFile(file, 'var a=1;\n//# sourceMappingURL=lib.js.map\n');
      expect(await new ChartJsAsset(file).source()).toBe('var a=1;');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe('AtomicFileWriter', () => {
  it('creates parent folders and writes the file', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'cclens-writer-'));
    try {
      const file = join(dir, 'reports', 'r.html');
      await new AtomicFileWriter().write(file, '<p>hi</p>');
      expect(await readFile(file, 'utf8')).toBe('<p>hi</p>');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

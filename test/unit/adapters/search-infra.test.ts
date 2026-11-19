import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { FetchHttpClient } from '../../../src/adapters/http/fetch-http-client.js';
import { FileCache } from '../../../src/adapters/storage/file-cache.js';
import { EnvSecretResolver } from '../../../src/adapters/system/env-secret-resolver.js';
import type { ProcessResult, ProcessRunner } from '../../../src/core/ports/infrastructure.js';
import { FixedClock } from '../../support/fakes.js';

describe('FileCache', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'cclens-cache-'));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('stores values until they expire, then removes them', async () => {
    const clock = new FixedClock(new Date('2026-11-19T12:00:00Z'));
    const cache = new FileCache(join(dir, 'cache'), clock);
    await cache.set('k', { a: 1 }, 60);
    expect(await cache.get('k')).toEqual({ a: 1 });
    clock.time = new Date('2026-11-19T12:01:01Z');
    expect(await cache.get('k')).toBeUndefined();
    expect(await readdir(join(dir, 'cache'))).toEqual([]);
  });

  it('skips zero TTLs and treats broken files as misses', async () => {
    const cache = new FileCache(dir, new FixedClock());
    await cache.set('zero', 1, 0);
    expect(await readdir(dir)).toEqual([]);
    await cache.set('k', 1, 60);
    const [file] = await readdir(dir);
    await writeFile(join(dir, file ?? ''), '{ broken');
    expect(await cache.get('k')).toBeUndefined();
    expect(await cache.get('missing')).toBeUndefined();
  });
});

class GhRunner implements ProcessRunner {
  calls = 0;
  constructor(private readonly result: ProcessResult | Error) {}
  run(): Promise<ProcessResult> {
    this.calls += 1;
    return this.result instanceof Error
      ? Promise.reject(this.result)
      : Promise.resolve(this.result);
  }
}

describe('EnvSecretResolver', () => {
  it('resolves ${env:NAME} references and reports missing ones', () => {
    const s = new EnvSecretResolver({ A: 'x', B: 'y' });
    expect(s.resolve('Bearer ${env:A}-${env:B}')).toBe('Bearer x-y');
    expect(s.resolve('plain')).toBe('plain');
    expect(s.resolve('${env:MISSING}')).toBeUndefined();
  });

  it('finds a GitHub token in config, env, then gh (once)', async () => {
    expect(
      await new EnvSecretResolver({ T: 'cfg', GITHUB_TOKEN: 'env' }).githubToken('${env:T}'),
    ).toBe('cfg');
    expect(await new EnvSecretResolver({ GH_TOKEN: 'gh-env' }).githubToken('${env:NOPE}')).toBe(
      'gh-env',
    );
    const runner = new GhRunner({ exitCode: 0, stdout: 'from-gh\n', stderr: '' });
    const s = new EnvSecretResolver({}, runner);
    expect(await s.githubToken()).toBe('from-gh');
    expect(await s.githubToken()).toBe('from-gh');
    expect(runner.calls).toBe(1);
  });

  it('returns undefined when gh is missing, fails or is signed out', async () => {
    expect(await new EnvSecretResolver({}).githubToken()).toBeUndefined();
    expect(
      await new EnvSecretResolver({}, new GhRunner(new Error('ENOENT'))).githubToken(),
    ).toBeUndefined();
    expect(
      await new EnvSecretResolver(
        {},
        new GhRunner({ exitCode: 1, stdout: '', stderr: 'no' }),
      ).githubToken(),
    ).toBeUndefined();
  });
});

describe('FetchHttpClient', () => {
  let server: Server;
  let base: string;
  const seen: Record<string, string | string[] | undefined>[] = [];
  beforeAll(async () => {
    server = createServer((req, res) => {
      seen.push(req.headers);
      if (req.url === '/json') {
        res.writeHead(200, { 'content-type': 'application/json', 'x-test': '1' });
        res.end('{"ok":true}');
      } else if (req.url === '/text') {
        res.writeHead(500);
        res.end('oops');
      } else {
        res.writeHead(204);
        res.end();
      }
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(async () => {
    await new Promise((resolve) => server.close(resolve));
  });

  it('returns status, headers and parsed JSON; non-JSON bodies become undefined', async () => {
    const http = new FetchHttpClient('cclens/test');
    const signal = new AbortController().signal;
    const ok = await http.getJson(`${base}/json`, { headers: { 'X-Extra': 'y' }, signal });
    expect(ok).toMatchObject({ status: 200, json: { ok: true } });
    expect(ok.headers['x-test']).toBe('1');
    expect(seen[0]).toMatchObject({
      'user-agent': 'cclens/test',
      accept: 'application/json',
      'x-extra': 'y',
    });
    expect(await http.getJson(`${base}/text`, { signal })).toMatchObject({
      status: 500,
      json: undefined,
    });
    expect(await http.getJson(`${base}/empty`, { signal })).toMatchObject({
      status: 204,
      json: undefined,
    });
  });
});

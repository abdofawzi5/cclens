import { request } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import type { UsageReport } from '../../../src/core/domain/report.js';
import {
  isLoopbackHost,
  LIVE_SCRIPT,
  liveToolbar,
  parseDays,
  reportStamp,
  UiServer,
} from '../../../src/interfaces/ui/ui-server.js';

const report = (days: number, cost = 1): UsageReport =>
  ({
    generatedAt: new Date(),
    since: new Date('2026-11-01T00:00:00Z'),
    until: new Date(),
    windowDays: days,
    summary: { costUsd: cost },
    daily: [],
    models: [],
    topSessions: [],
    unusedSkills: [],
    unusedListingTokens: 0,
    findings: [],
    notes: [],
  }) as unknown as UsageReport;

interface Reply {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: string;
}

function get(url: string, options: { host?: string; method?: string } = {}): Promise<Reply> {
  return new Promise((resolve, reject) => {
    const req = request(
      url,
      {
        method: options.method ?? 'GET',
        headers: options.host ? { host: options.host } : {},
      },
      (res) => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (c: string) => (body += c));
        res.on('end', () => {
          resolve({ status: res.statusCode ?? 0, headers: res.headers, body });
        });
      },
    );
    req.on('error', reject);
    req.end();
  });
}

describe('ui server helpers', () => {
  it('accepts only loopback Host headers', () => {
    for (const ok of ['localhost:4477', '127.0.0.1:1', '127.9.9.9', '[::1]:4477', 'localhost']) {
      expect(isLoopbackHost(ok), ok).toBe(true);
    }
    for (const bad of [
      undefined,
      '',
      'evil.example',
      'localhost.evil.example',
      '127.0.0.1.evil',
      '[::2]',
    ]) {
      expect(isLoopbackHost(bad), String(bad)).toBe(false);
    }
  });

  it('parses the window and falls back on bad input', () => {
    expect(parseDays('7', 30)).toBe(7);
    expect(parseDays(null, 30)).toBe(30);
    for (const bad of ['0', '366', '-1', '1e2', '7d', '']) expect(parseDays(bad, 30)).toBe(30);
  });

  it('stamps the data, not the time it was built', () => {
    const a = report(7);
    const b = { ...report(7), generatedAt: new Date(0), until: new Date(0) };
    expect(reportStamp(a)).toBe(reportStamp(b));
    expect(reportStamp(report(7, 2))).not.toBe(reportStamp(a));
  });

  it('marks the current window and carries the stamp for the live script', () => {
    const html = liveToolbar(14, 'abc');
    expect(html).toContain('<a href="/?days=14" aria-current="page">14 days</a>');
    expect(html).toContain('data-stamp="abc" data-days="14"');
    expect(LIVE_SCRIPT).toContain("fetch('/api/stamp?days='");
  });
});

describe('UiServer', () => {
  let server: UiServer | undefined;
  afterEach(async () => {
    await server?.close();
  });

  const start = async (now: () => number = Date.now) => {
    const builds: number[] = [];
    let cost = 1;
    server = new UiServer({
      defaultDays: 30,
      maxAgeMs: 1000,
      now,
      build: (days) => {
        builds.push(days);
        return Promise.resolve(report(days, cost));
      },
      render: (r, days, stamp) => `<html>${String(r.windowDays)} ${String(days)} ${stamp}</html>`,
    });
    const url = await server.listen(0);
    return {
      url,
      builds,
      setCost: (n: number) => {
        cost = n;
      },
    };
  };

  it('serves the page, the report JSON and the stamp, with strict headers', async () => {
    const { url, builds } = await start();
    expect(url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/$/);
    const page = await get(`${url}?days=7`);
    expect(page.status).toBe(200);
    expect(page.body).toMatch(/^<html>7 7 [0-9a-f]{16}<\/html>$/);
    expect(page.headers['content-security-policy']).toContain("default-src 'none'");
    expect(page.headers['cache-control']).toBe('no-store');
    const json = JSON.parse((await get(`${url}api/report?days=7`)).body) as UsageReport;
    expect(json.windowDays).toBe(7);
    const stamp = JSON.parse((await get(`${url}api/stamp?days=7`)).body) as { stamp: string };
    expect(page.body).toContain(stamp.stamp);
    expect(builds).toEqual([7]);
    expect((await get(`${url}?days=bad`)).body).toMatch(/^<html>30 30 /);
  });

  it('refuses other hosts, other methods and unknown paths', async () => {
    const { url } = await start();
    expect((await get(url, { host: 'evil.example' })).status).toBe(403);
    expect((await get(url, { method: 'POST' })).status).toBe(405);
    expect((await get(`${url}nope`)).status).toBe(404);
    expect((await get(url, { method: 'HEAD' })).body).toBe('');
  });

  it('rebuilds a stale report once and changes the stamp when the data changes', async () => {
    let t = 0;
    const { url, builds, setCost } = await start(() => t);
    const first = JSON.parse((await get(`${url}api/stamp`)).body) as { stamp: string };
    setCost(5);
    t = 500;
    expect(JSON.parse((await get(`${url}api/stamp`)).body)).toMatchObject(first);
    t = 2000;
    const [a, b] = await Promise.all([get(`${url}api/stamp`), get(`${url}api/stamp`)]);
    expect(a.body).toBe(b.body);
    expect((JSON.parse(a.body) as { stamp: string }).stamp).not.toBe(first.stamp);
    expect(builds).toEqual([30, 30]);
  });
});

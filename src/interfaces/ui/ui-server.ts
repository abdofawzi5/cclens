import { createHash } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { UsageReport } from '../../core/domain/report.js';

/*
 * `cclens ui` (PLAN Phase 12): the Phase 7 report served from 127.0.0.1 with live
 * refresh. It adds no data, only a view. Safety: it listens on loopback only, answers
 * only requests whose Host header is a loopback name (so a web page cannot reach it
 * through DNS rebinding), only GET, and sends a strict Content-Security-Policy.
 */

export interface UiServerDeps {
  /** Builds the report for a window (runs ccusage; about a second). */
  build(days: number): Promise<UsageReport>;
  /** The full HTML page for a report. */
  render(report: UsageReport, days: number, stamp: string): string;
  readonly defaultDays: number;
  /** Rebuild a cached report when it is older than this. */
  readonly maxAgeMs?: number;
  readonly now?: () => number;
}

interface Entry {
  report: UsageReport;
  stamp: string;
  builtAt: number;
}

export const DAY_CHOICES = [7, 14, 30, 90] as const;
const MAX_DAYS = 365;

const SECURITY_HEADERS = {
  'Content-Security-Policy':
    "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; img-src data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Cache-Control': 'no-store',
};

/** A fingerprint of the report's data, ignoring when it was generated. */
export function reportStamp(report: UsageReport): string {
  const data = JSON.stringify({ ...report, generatedAt: null, until: null });
  return createHash('sha256').update(data).digest('hex').slice(0, 16);
}

/** True for `localhost`, `127.x.x.x` and `[::1]`, with any port. */
export function isLoopbackHost(host: string | undefined): boolean {
  if (!host) return false;
  const name = host.startsWith('[') ? host.slice(0, host.indexOf(']') + 1) : host.split(':')[0];
  return (
    name === 'localhost' ||
    name === '[::1]' ||
    (name !== undefined && /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(name))
  );
}

/** `?days=` as a whole number of days from 1 to 365, else the default. */
export function parseDays(value: string | null, fallback: number): number {
  if (value === null || !/^\d{1,3}$/.test(value)) return fallback;
  const n = Number(value);
  return n >= 1 && n <= MAX_DAYS ? n : fallback;
}

export class UiServer {
  private readonly cache = new Map<number, Entry>();
  private readonly building = new Map<number, Promise<Entry>>();
  private server: Server | undefined;

  constructor(private readonly deps: UiServerDeps) {}

  /** Starts listening on 127.0.0.1; port 0 picks a free one. Resolves with the URL. */
  async listen(port: number): Promise<string> {
    const server = createServer((req, res) => {
      this.handle(req, res).catch((error: unknown) => {
        this.send(res, 500, 'text/plain; charset=utf-8', `cclens: ${String(error)}`);
      });
    });
    this.server = server;
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(port, '127.0.0.1', () => {
        server.off('error', reject);
        resolve();
      });
    });
    const { port: bound } = server.address() as AddressInfo;
    return `http://127.0.0.1:${String(bound)}/`;
  }

  close(): Promise<void> {
    const server = this.server;
    if (!server) return Promise.resolve();
    return new Promise((resolve) => {
      server.close(() => {
        resolve();
      });
      server.closeAllConnections();
    });
  }

  private now(): number {
    return this.deps.now?.() ?? Date.now();
  }

  /** The cached report, rebuilt when stale; one build at a time per window. */
  async entry(days: number): Promise<Entry> {
    const cached = this.cache.get(days);
    const maxAge = this.deps.maxAgeMs ?? 60_000;
    if (cached && this.now() - cached.builtAt < maxAge) return cached;
    let pending = this.building.get(days);
    if (!pending) {
      pending = this.deps
        .build(days)
        .then((report) => {
          const e = { report, stamp: reportStamp(report), builtAt: this.now() };
          this.cache.set(days, e);
          return e;
        })
        .finally(() => this.building.delete(days));
      this.building.set(days, pending);
    }
    return pending;
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (!isLoopbackHost(req.headers.host)) {
      this.send(res, 403, 'text/plain; charset=utf-8', 'cclens ui answers only on localhost.');
      return;
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.setHeader('Allow', 'GET, HEAD');
      this.send(res, 405, 'text/plain; charset=utf-8', 'Method not allowed.');
      return;
    }
    const url = new URL(req.url ?? '/', 'http://localhost');
    const days = parseDays(url.searchParams.get('days'), this.deps.defaultDays);
    switch (url.pathname) {
      case '/': {
        const e = await this.entry(days);
        this.send(res, 200, 'text/html; charset=utf-8', this.deps.render(e.report, days, e.stamp));
        return;
      }
      case '/api/report': {
        const e = await this.entry(days);
        this.send(res, 200, 'application/json; charset=utf-8', JSON.stringify(e.report));
        return;
      }
      case '/api/stamp': {
        const e = await this.entry(days);
        this.send(
          res,
          200,
          'application/json; charset=utf-8',
          JSON.stringify({ stamp: e.stamp, builtAt: new Date(e.builtAt).toISOString() }),
        );
        return;
      }
      default:
        this.send(res, 404, 'text/plain; charset=utf-8', 'Not found.');
    }
  }

  private send(res: ServerResponse, status: number, type: string, body: string): void {
    if (res.headersSent) {
      res.end();
      return;
    }
    res.writeHead(status, { ...SECURITY_HEADERS, 'Content-Type': type });
    res.end(res.req.method === 'HEAD' ? undefined : body);
  }
}

/** Window links and the live-refresh status line under the page header. */
export function liveToolbar(days: number, stamp: string): string {
  const links = DAY_CHOICES.map(
    (d) =>
      `<a href="/?days=${String(d)}"${d === days ? ' aria-current="page"' : ''}>${String(d)} days</a>`,
  ).join('');
  return `<nav class="toolbar" aria-label="Window">${links}<span class="status" id="cclens-live" data-stamp="${stamp}" data-days="${String(days)}">Live: checks for new data every 30 s</span></nav>`;
}

/**
 * Polls `/api/stamp`; when the data changed, reloads the page and keeps the scroll
 * position. Stops polling while the tab is hidden.
 */
export const LIVE_SCRIPT = `(() => {
  const el = document.getElementById('cclens-live');
  if (!el) return;
  const days = el.dataset.days;
  let stamp = el.dataset.stamp;
  try {
    const y = sessionStorage.getItem('cclens-scroll');
    if (y) { sessionStorage.removeItem('cclens-scroll'); window.scrollTo(0, Number(y)); }
  } catch {}
  const check = async () => {
    if (document.hidden) return;
    try {
      const r = await fetch('/api/stamp?days=' + days, { cache: 'no-store' });
      if (!r.ok) throw new Error(String(r.status));
      const j = await r.json();
      if (j.stamp !== stamp) {
        try { sessionStorage.setItem('cclens-scroll', String(window.scrollY)); } catch {}
        location.reload();
        return;
      }
      el.textContent = 'Live: up to date as of ' + new Date(j.builtAt).toLocaleTimeString();
    } catch {
      el.textContent = 'Live: cclens ui is not running (start it with: cclens ui)';
    }
  };
  setInterval(check, 30000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) check(); });
})();`;

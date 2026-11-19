import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { HttpClient, HttpResponse } from '../../src/core/ports/infrastructure.js';

export const engineFixture = (name: string): unknown =>
  JSON.parse(readFileSync(join(import.meta.dirname, '..', 'fixtures', 'engines', name), 'utf8'));

type Route = (url: string) => HttpResponse | Error | undefined;

/** HttpClient that answers from routes and records every request. */
export class FakeHttp implements HttpClient {
  readonly calls: { url: string; headers: Record<string, string> }[] = [];
  constructor(private readonly routes: Route[] = []) {}

  route(match: RegExp, response: HttpResponse | Error | ((url: string) => HttpResponse)): this {
    this.routes.push((url) =>
      match.test(url) ? (typeof response === 'function' ? response(url) : response) : undefined,
    );
    return this;
  }

  getJson(
    url: string,
    options: { headers?: Record<string, string>; signal: AbortSignal },
  ): Promise<HttpResponse> {
    this.calls.push({ url, headers: options.headers ?? {} });
    for (const r of this.routes) {
      const res = r(url);
      if (res instanceof Error) return Promise.reject(res);
      if (res) return Promise.resolve(res);
    }
    return Promise.resolve({ status: 404, headers: {}, json: { message: 'Not Found' } });
  }
}

export const json = (body: unknown, status = 200): HttpResponse => ({
  status,
  headers: {},
  json: body,
});

/** In-memory Cache. */
export class MemoryCache {
  readonly data = new Map<string, unknown>();
  get<T>(key: string): Promise<T | undefined> {
    return Promise.resolve(this.data.get(key) as T | undefined);
  }
  set(key: string, value: unknown, ttl: number): Promise<void> {
    if (ttl > 0) this.data.set(key, JSON.parse(JSON.stringify(value)));
    return Promise.resolve();
  }
}

/** SecretResolver with fixed values. */
export class FixedSecrets {
  constructor(
    private readonly env: Record<string, string> = {},
    private readonly token?: string,
  ) {}
  resolve(text: string): string | undefined {
    const missing: string[] = [];
    const out = text.replace(/\$\{env:([A-Z_][A-Z0-9_]*)\}/g, (_m, n: string) => {
      const v = this.env[n];
      if (v === undefined) missing.push(n);
      return v ?? '';
    });
    return missing.length > 0 ? undefined : out;
  }
  githubToken(): Promise<string | undefined> {
    return Promise.resolve(this.token);
  }
}

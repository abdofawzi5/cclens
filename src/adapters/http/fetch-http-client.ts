import type { HttpClient, HttpResponse } from '../../core/ports/infrastructure.js';

/** HttpClient over the built-in `fetch`. Sends a generic User-Agent and nothing else about the user. */
export class FetchHttpClient implements HttpClient {
  constructor(private readonly userAgent: string) {}

  async getJson(
    url: string,
    options: { headers?: Record<string, string>; signal: AbortSignal },
  ): Promise<HttpResponse> {
    const res = await fetch(url, {
      headers: { Accept: 'application/json', 'User-Agent': this.userAgent, ...options.headers },
      signal: options.signal,
      redirect: 'follow',
    });
    const text = await res.text();
    let json: unknown;
    try {
      json = text ? JSON.parse(text) : undefined;
    } catch {
      json = undefined;
    }
    const headers: Record<string, string> = {};
    res.headers.forEach((value, key) => {
      headers[key] = value;
    });
    return { status: res.status, headers, json };
  }
}

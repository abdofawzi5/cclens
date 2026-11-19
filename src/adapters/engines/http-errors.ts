import { EngineError } from '../../core/errors.js';
import type { HttpResponse } from '../../core/ports/infrastructure.js';

/** Throws a readable EngineError for non-2xx responses; returns the JSON body otherwise. */
export function okJson(engineId: string, res: HttpResponse, hint = ''): unknown {
  if (res.status >= 200 && res.status < 300) return res.json;
  const reason =
    res.status === 401
      ? 'needs authentication'
      : res.status === 403 || res.status === 429
        ? `rate limit reached or access denied${hint ? `; ${hint}` : ''}`
        : `HTTP ${res.status}`;
  throw new EngineError(engineId, `${engineId}: ${reason}`);
}

/** Throws a readable EngineError when a response does not have the expected shape. */
export function unexpectedShape(engineId: string, detail?: string): never {
  throw new EngineError(
    engineId,
    `${engineId}: unexpected response; the API may have changed${detail ? ` (${detail})` : ''}`,
  );
}

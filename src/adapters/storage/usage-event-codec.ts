import { z } from 'zod';
import { USAGE_EVENT_VERSION, type UsageEvent } from '../../core/domain/usage-event.js';

const lineSchema = z.object({
  v: z.literal(USAGE_EVENT_VERSION),
  ts: z.iso.datetime(),
  source: z.enum(['auto', 'typed', 'backfill', 'legacy']),
  skill: z.string().min(1),
  project: z.string(),
  sessionId: z.string().optional(),
});

/** One JSON object per line; field order fixed for readable files. */
export function encodeUsageEvent(e: UsageEvent): string {
  return JSON.stringify({
    v: e.v,
    ts: e.ts.toISOString(),
    source: e.source,
    skill: e.skill,
    project: e.project,
    ...(e.sessionId === undefined ? {} : { sessionId: e.sessionId }),
  });
}

/** Returns undefined for blank or malformed lines instead of throwing. */
export function decodeUsageEvent(line: string): UsageEvent | undefined {
  if (!line.trim()) return undefined;
  let raw: unknown;
  try {
    raw = JSON.parse(line);
  } catch {
    return undefined;
  }
  const parsed = lineSchema.safeParse(raw);
  if (!parsed.success) return undefined;
  const { ts, sessionId, ...rest } = parsed.data;
  return { ...rest, ts: new Date(ts), ...(sessionId === undefined ? {} : { sessionId }) };
}

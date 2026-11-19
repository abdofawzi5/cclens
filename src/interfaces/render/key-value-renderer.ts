import pc from 'picocolors';
import type { Renderer } from './renderer.js';

/** Aligned `key  value` lines for flat objects. */
export class KeyValueRenderer implements Renderer {
  render(data: unknown): string {
    if (data === null || typeof data !== 'object') return String(data);
    const entries = Object.entries(data as Record<string, unknown>);
    const width = Math.max(0, ...entries.map(([k]) => k.length));
    return entries.map(([k, v]) => `${pc.bold(k.padEnd(width))}  ${formatValue(v)}`).join('\n');
  }
}

function formatValue(v: unknown): string {
  if (v instanceof Date) return v.toISOString();
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean' || typeof v === 'bigint') return v.toString();
  if (v === undefined || v === null) return '';
  return JSON.stringify(v);
}

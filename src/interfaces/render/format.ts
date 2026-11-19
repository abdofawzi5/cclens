export { compact, percent, usd } from '../../core/util/format.js';

/** `-Users-me-Workspace-site` → `Workspace-site` (drops the encoded home prefix). */
export function shortProject(encoded: string, home?: string): string {
  if (home) {
    const prefix = home.replace(/[\\/.]/g, '-');
    if (encoded.startsWith(`${prefix}-`)) return encoded.slice(prefix.length + 1);
  }
  return encoded.replace(/^-/, '');
}

/** Cuts long text to `max` characters with an ellipsis. */
export function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

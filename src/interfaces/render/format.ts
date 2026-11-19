/** Compact human numbers: 1234 → 1.2K, 1234567 → 1.2M, 1.2e9 → 1.2B. */
export function compact(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 1e9) return `${(n / 1e9).toFixed(1)}B`;
  if (abs >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (abs >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return String(Math.round(n));
}

export function usd(n: number): string {
  return `$${n.toFixed(2)}`;
}

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

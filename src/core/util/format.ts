/** Compact human numbers: 1234 → 1.2K, 1234567 → 1.2M, 1.2e9 → 1.2B. */
export function compact(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 1e9) return `${(n / 1e9).toFixed(1)}B`;
  if (abs >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (abs >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return String(Math.round(n));
}

/** 0.4567 → `46%`. */
export function percent(fraction: number): string {
  return `${Math.round(fraction * 100)}%`;
}

/** Local calendar day as `YYYY-MM-DD`. */
export function localDay(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

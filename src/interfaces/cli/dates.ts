import { InvalidArgumentError } from 'commander';

/**
 * Parses `--since`/`--until`: `YYYY-MM-DD`, `YYYYMMDD`, or a relative `7d`/`4w`/`3m`.
 * Relative values count back from `now` to local midnight.
 */
export function parseDateOption(value: string, now: Date = new Date()): Date {
  const rel = /^(\d+)([dwm])$/.exec(value);
  if (rel) {
    const n = Number(rel[1]);
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    if (rel[2] === 'd') d.setDate(d.getDate() - n);
    else if (rel[2] === 'w') d.setDate(d.getDate() - 7 * n);
    else d.setMonth(d.getMonth() - n);
    return d;
  }
  const abs = /^(\d{4})-?(\d{2})-?(\d{2})$/.exec(value);
  if (abs) {
    const d = new Date(Number(abs[1]), Number(abs[2]) - 1, Number(abs[3]));
    if (d.getMonth() === Number(abs[2]) - 1 && d.getDate() === Number(abs[3])) return d;
  }
  throw new InvalidArgumentError('use YYYY-MM-DD, YYYYMMDD, or a relative value like 7d, 4w, 3m');
}

export function parsePositiveInt(value: string): number {
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) {
    throw new InvalidArgumentError('must be a positive whole number');
  }
  return n;
}

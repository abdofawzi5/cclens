import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { readRollupFile } from '../../adapters/storage/spend-rollup-file.js';
import { DetachedRunner } from '../../adapters/system/detached-runner.js';
import { resolvePaths } from '../../adapters/system/paths.js';
import { REFRESH_ARGS } from '../../app/budget-service.js';
import {
  type Budget,
  budgetStatus,
  money,
  ROLLUP_MAX_AGE_MS,
  type SpendRollup,
} from '../../core/domain/budget.js';
import { localDay } from '../../core/util/format.js';

/*
 * `cclens statusline`: Claude Code runs it on every status-line redraw, so it must
 * answer in well under 100 ms. main.ts loads this module directly, without commander,
 * zod or the container; it only reads two small JSON files. When the spend rollup is
 * stale it starts a detached `cclens budget refresh` and prints what it has.
 */

export interface StatuslineState {
  readonly budget?: Budget | undefined;
  readonly rollup?: SpendRollup | undefined;
  readonly now: Date;
}

/** `cclens · today $12 / $50 · month $310 · 4 skill uses today`. Pure. */
export function statuslineText({ budget, rollup, now }: StatuslineState): string {
  if (!rollup) return 'cclens · estimating spend…';
  const day = localDay(now);
  const today = rollup.day === day ? rollup.todayUsd : 0;
  const month = rollup.month === day.slice(0, 7) ? rollup.monthUsd : 0;
  const uses = rollup.day === day ? rollup.skillUsesToday : 0;
  const statuses = budget ? budgetStatus(budget, rollup, day) : [];
  const limitOf = (limit: 'daily' | 'monthly'): string => {
    const s = statuses.find((x) => x.limit === limit);
    if (!s) return '';
    return `${s.over ? ' ⚠' : ''} / ${money(s.limitUsd)}`;
  };
  const parts = [
    'cclens',
    `today ${money(today)}${limitOf('daily')}`,
    `month ${money(month)}${limitOf('monthly')}`,
  ];
  if (uses > 0) parts.push(`${String(uses)} skill use${uses === 1 ? '' : 's'} today`);
  return parts.join(' · ');
}

/** `config.budget` read by hand (no zod); anything odd reads as no budget. */
export function budgetFromConfig(raw: unknown): Budget | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const b = (raw as Record<string, unknown>)['budget'];
  if (!b || typeof b !== 'object') return undefined;
  const o = b as Record<string, unknown>;
  const pos = (v: unknown): number | undefined =>
    typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : undefined;
  const daily = pos(o['daily']);
  const monthly = pos(o['monthly']);
  if (daily === undefined && monthly === undefined) return undefined;
  return { daily, monthly, warnAt: pos(o['warnAt']) ?? 100 };
}

async function readJson(path: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch {
    return undefined;
  }
}

function readAll(stream: NodeJS.ReadStream, timeoutMs: number): Promise<string> {
  if (stream.isTTY) return Promise.resolve('');
  return new Promise((resolve) => {
    let data = '';
    const done = (): void => {
      clearTimeout(timer);
      resolve(data);
    };
    const timer = setTimeout(done, timeoutMs);
    stream.setEncoding('utf8');
    stream.on('data', (chunk: string) => (data += chunk));
    stream.on('end', done);
    stream.on('error', done);
  });
}

/** Runs `ccusage statusline` with Claude Code's JSON on stdin; '' on any failure. */
function ccusageLine(input: string, timeoutMs: number): Promise<string> {
  return new Promise((resolve) => {
    let cli: string;
    try {
      const require = createRequire(import.meta.url);
      cli = join(dirname(require.resolve('ccusage/package.json')), 'src', 'cli.js');
    } catch {
      resolve('');
      return;
    }
    let out = '';
    const child = spawn(process.execPath, [cli, 'statusline', '--offline'], {
      stdio: ['pipe', 'pipe', 'ignore'],
    });
    const timer = setTimeout(() => {
      child.kill();
      resolve('');
    }, timeoutMs);
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => (out += chunk));
    child.on('error', () => {
      clearTimeout(timer);
      resolve('');
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve(code === 0 ? (out.trim().split('\n')[0] ?? '') : '');
    });
    child.stdin.on('error', () => undefined);
    child.stdin.end(input);
  });
}

export interface StatuslineOptions {
  readonly withCcusage?: boolean;
  readonly env?: NodeJS.ProcessEnv;
  readonly now?: Date;
  readonly stdin?: NodeJS.ReadStream;
  /** Starts the background refresh; defaults to a detached `cclens budget refresh`. */
  readonly refresh?: () => void;
}

export async function statusline(options: StatuslineOptions = {}): Promise<string> {
  const paths = resolvePaths(options.env);
  const now = options.now ?? new Date();
  const [config, rollup, input] = await Promise.all([
    readJson(paths.configFile),
    readRollupFile(paths.spendFile),
    options.withCcusage ? readAll(options.stdin ?? process.stdin, 200) : Promise.resolve(''),
  ]);
  if (!rollup || now.getTime() - rollup.updatedAt.getTime() > ROLLUP_MAX_AGE_MS) {
    if (options.refresh) options.refresh();
    else new DetachedRunner().start(REFRESH_ARGS);
  }
  const ours = statuslineText({ budget: budgetFromConfig(config), rollup, now });
  if (!options.withCcusage) return ours;
  const theirs = await ccusageLine(input, 1500);
  return theirs ? `${theirs} | ${ours}` : ours;
}

/** Entry for main.ts: never throws and always exits 0, so the status line never breaks. */
export async function runStatusline(argv: readonly string[]): Promise<void> {
  try {
    const line = await statusline({ withCcusage: argv.includes('--with-ccusage') });
    process.stdout.write(`${line}\n`);
  } catch {
    process.stdout.write('cclens\n');
  }
  process.exitCode = 0;
}

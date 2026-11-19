import type { CclensConfig } from '../config/schema.js';
import type { SpendRollup } from '../domain/budget.js';

export interface ConfigStore {
  readonly path: string;
  exists(): Promise<boolean>;
  /** Loads, validates and migrates the config; returns defaults when missing. */
  load(): Promise<CclensConfig>;
  save(config: CclensConfig): Promise<void>;
}

export interface Cache {
  get<T>(key: string): Promise<T | undefined>;
  set(key: string, value: unknown, ttlSeconds: number): Promise<void>;
}

export interface Clock {
  now(): Date;
}

export interface ProcessResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

/** Runs external programs (ccusage, claude). Lets tests replace subprocesses. */
export interface ProcessRunner {
  run(
    command: string,
    args: readonly string[],
    options?: { timeoutMs?: number; input?: string; env?: Record<string, string> },
  ): Promise<ProcessResult>;
}

export interface Logger {
  debug(message: string, meta?: Record<string, unknown>): void;
  warn(message: string, meta?: Record<string, unknown>): void;
  error(message: string, meta?: Record<string, unknown>): void;
}

/** Resolved filesystem locations. */
export interface Paths {
  /** cclens data dir (`$CCLENS_HOME` or `~/.cclens`). */
  readonly home: string;
  readonly configFile: string;
  readonly eventsFile: string;
  readonly cacheDir: string;
  readonly backupsDir: string;
  readonly hookErrorLog: string;
  /** Command line that starts the cclens CLI, read by the plugin's hook script (ADR 0006). */
  readonly hookRunnerFile: string;
  /** Spend snapshot read by the hook and status line (`cache/spend.json`). */
  readonly spendFile: string;
  /** Claude Code config dir (`$CLAUDE_CONFIG_DIR` or `~/.claude`). */
  readonly claudeHome: string;
  readonly claudeProjectsDir: string;
  readonly claudeSkillsDir: string;
  /** Folders scanned for installed plugins (Claude Code and the desktop app). */
  readonly pluginRoots: readonly string[];
  /** Pre-cclens log created by the manual hook. */
  readonly legacyUsageLog: string;
}

/** Writes a text file the user asked for, such as a report (atomic, parent folders created). */
export interface FileWriter {
  write(path: string, data: string): Promise<void>;
}

/** Reads and writes the spend snapshot. `read` never throws: a broken file reads as missing. */
export interface SpendRollupStore {
  read(): Promise<SpendRollup | undefined>;
  write(rollup: SpendRollup): Promise<void>;
}

/** Starts a cclens command in the background and returns at once (used to refresh the rollup). */
export interface BackgroundRunner {
  start(args: readonly string[]): void;
}

/** Opens a file or URL in the user's default app (browser for HTML). */
export interface Opener {
  open(target: string): Promise<void>;
}

/** The source code of a front-end library to inline into a self-contained HTML file. */
export interface ScriptAsset {
  readonly name: string;
  readonly license: string;
  source(): Promise<string>;
}

/** Minimal read-only file system queries the application layer may need. */
export interface FileProbe {
  exists(path: string): Promise<boolean>;
}

export interface HttpResponse {
  readonly status: number;
  readonly headers: Readonly<Record<string, string>>;
  /** Parsed JSON body; undefined when the body is not JSON. */
  readonly json: unknown;
}

/** Fetches JSON over HTTPS. Lets engines be tested against recorded responses. */
export interface HttpClient {
  getJson(
    url: string,
    options: { headers?: Record<string, string>; signal: AbortSignal },
  ): Promise<HttpResponse>;
}

/** Turns `${env:NAME}` references into values. Secrets never live in the config file. */
export interface SecretResolver {
  /** Replaces every `${env:NAME}` in `text`; undefined when a referenced value is missing. */
  resolve(text: string): string | undefined;
  /** A GitHub token from config, `GITHUB_TOKEN`, or the GitHub CLI (`gh auth token`). */
  githubToken(ref?: string): Promise<string | undefined>;
}

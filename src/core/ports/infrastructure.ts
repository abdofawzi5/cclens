import type { CclensConfig } from '../config/schema.js';

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
  /** Claude Code config dir (`$CLAUDE_CONFIG_DIR` or `~/.claude`). */
  readonly claudeHome: string;
  readonly claudeProjectsDir: string;
  readonly claudeSkillsDir: string;
  /** Folders scanned for installed plugins (Claude Code and the desktop app). */
  readonly pluginRoots: readonly string[];
  /** Pre-cclens log created by the manual hook. */
  readonly legacyUsageLog: string;
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

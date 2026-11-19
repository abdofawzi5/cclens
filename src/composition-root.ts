import { realpathSync } from 'node:fs';
import { createRequire } from 'node:module';
import { delimiter, dirname, join } from 'node:path';
import { JsonSettingsManager } from './adapters/claude/json-settings-manager.js';
import { PluginTreeSource } from './adapters/claude/skills/plugin-tree-source.js';
import { SkillDirSource } from './adapters/claude/skills/skill-dir-source.js';
import { CcusageTokenProvider } from './adapters/tokens/ccusage-token-provider.js';
import { CompositeSkillSource } from './app/inventory/composite-skill-source.js';
import type { SkillSource } from './core/ports/skills.js';
import type { TokenUsageProvider } from './core/ports/tokens.js';
import { LegacyLogSource } from './adapters/claude/history/legacy-log-source.js';
import { TranscriptSource } from './adapters/claude/history/transcript-source.js';
import { JsonConfigStore } from './adapters/storage/json-config-store.js';
import { JsonlEventStore } from './adapters/storage/jsonl-event-store.js';
import { FileLogger } from './adapters/system/file-logger.js';
import { NodeFileProbe } from './adapters/system/node-file-probe.js';
import { NodeProcessRunner } from './adapters/system/node-process-runner.js';
import { resolvePaths } from './adapters/system/paths.js';
import { SystemClock } from './adapters/system/system-clock.js';
import type { ClaudeSettingsManager } from './core/ports/claude-settings.js';
import type {
  Clock,
  ConfigStore,
  FileProbe,
  Logger,
  Paths,
  ProcessRunner,
} from './core/ports/infrastructure.js';
import type { UsageEventStore, UsageHistorySource } from './core/ports/usage.js';

/**
 * Every dependency the application needs, typed by port.
 * Grows phase by phase (token provider, skill sources, engines…).
 */
export interface Container {
  readonly paths: Paths;
  readonly clock: Clock;
  readonly logger: Logger;
  readonly processRunner: ProcessRunner;
  readonly files: FileProbe;
  readonly configStore: ConfigStore;
  readonly eventStore: UsageEventStore;
  readonly settings: ClaudeSettingsManager;
  readonly legacySource: UsageHistorySource;
  readonly transcriptSource: UsageHistorySource;
  /** All installed skills: personal, project and plugin (Composite). */
  readonly skillSource: SkillSource;
  readonly tokens: TokenUsageProvider;
  /** Shell command that starts this cclens CLI; written into Claude Code hooks. */
  readonly selfCommand: string;
  readonly nodeVersion: string;
}

export interface ContainerOptions {
  readonly env?: NodeJS.ProcessEnv;
  readonly cwd?: string;
  readonly verbose?: boolean;
  /** Replace any dependency, e.g. with fakes in tests. */
  readonly overrides?: Partial<Container>;
}

/**
 * Absolute node binary + absolute CLI script. Absolute paths keep the hook working
 * in GUI apps (like the Claude desktop app) that do not inherit the shell's PATH.
 */
function defaultSelfCommand(env: NodeJS.ProcessEnv = process.env): string {
  const script = process.argv[1] ?? 'cclens';
  let resolved = script;
  try {
    resolved = realpathSync(script);
  } catch {
    // Keep the unresolved path; `cclens doctor` reports it if it is wrong.
  }
  return `"${stableNodePath(env)}" "${resolved}"`;
}

/**
 * `process.execPath` is often a versioned path (e.g. Homebrew's `Cellar/node/26.8.1/bin/node`)
 * that disappears on upgrade. Prefer the first `node` on PATH that resolves to the same binary,
 * such as `/opt/homebrew/bin/node`, which survives upgrades.
 */
export function stableNodePath(env: NodeJS.ProcessEnv = process.env): string {
  const exec = process.execPath;
  let target: string;
  try {
    target = realpathSync(exec);
  } catch {
    return exec;
  }
  const binary = process.platform === 'win32' ? 'node.exe' : 'node';
  for (const dir of (env['PATH'] ?? '').split(delimiter)) {
    if (!dir) continue;
    const candidate = join(dir, binary);
    try {
      if (candidate !== target && realpathSync(candidate) === target) return candidate;
    } catch {
      // Not on this PATH entry.
    }
  }
  return exec;
}

/** ccusage ships only a CLI (no library exports since v20; see ADR 0002). */
function ccusageCliPath(): string {
  const require = createRequire(import.meta.url);
  return join(dirname(require.resolve('ccusage/package.json')), 'src', 'cli.js');
}

/** The only place concrete adapters are instantiated. */
export function createContainer(options: ContainerOptions = {}): Container {
  const o = options.overrides ?? {};
  const paths = o.paths ?? resolvePaths(options.env);
  const clock = o.clock ?? new SystemClock();
  const logger = o.logger ?? new FileLogger(paths.hookErrorLog, options.verbose ?? false);
  return {
    paths,
    clock,
    logger,
    processRunner: new NodeProcessRunner(),
    files: new NodeFileProbe(),
    configStore: new JsonConfigStore(paths.configFile),
    eventStore: new JsonlEventStore(paths.eventsFile, logger),
    settings: new JsonSettingsManager(
      paths.claudeHome,
      options.cwd ?? process.cwd(),
      paths.backupsDir,
      clock,
    ),
    legacySource: new LegacyLogSource(paths.legacyUsageLog),
    transcriptSource: new TranscriptSource(paths.claudeProjectsDir, logger),
    skillSource: new CompositeSkillSource([
      new SkillDirSource('personal', paths.claudeSkillsDir, 'personal'),
      new SkillDirSource(
        'project',
        join(options.cwd ?? process.cwd(), '.claude', 'skills'),
        'project',
      ),
      new PluginTreeSource(paths.pluginRoots),
    ]),
    tokens: new CcusageTokenProvider(new NodeProcessRunner(), {
      command: [process.execPath, ccusageCliPath()],
    }),
    selfCommand: o.selfCommand ?? defaultSelfCommand(options.env),
    nodeVersion: process.version,
    ...o,
  };
}

import { realpathSync } from 'node:fs';
import { createRequire } from 'node:module';
import { delimiter, dirname, join } from 'node:path';
import { AgentDirSource, PluginAgentSource } from './adapters/claude/agents/agent-sources.js';
import { TranscriptAgentSource } from './adapters/claude/history/agent-activity-source.js';
import { LiteLlmPriceList } from './adapters/pricing/litellm-price-list.js';
import { CompositeAgentSource } from './app/inventory/composite-agent-source.js';
import type { AgentActivitySource, AgentSource, PriceList } from './core/ports/agents.js';
import type { ContextOverheadSource } from './core/ports/overhead.js';
import { JsonSettingsManager } from './adapters/claude/json-settings-manager.js';
import { PluginTreeSource } from './adapters/claude/skills/plugin-tree-source.js';
import { SkillDirSource } from './adapters/claude/skills/skill-dir-source.js';
import { DefaultEngineFactory } from './adapters/engines/engine-factory.js';
import { GithubMetadataProvider } from './adapters/engines/github/github-metadata-provider.js';
import { FetchHttpClient } from './adapters/http/fetch-http-client.js';
import { FileCache } from './adapters/storage/file-cache.js';
import { EnvSecretResolver } from './adapters/system/env-secret-resolver.js';
import { CcusageTokenProvider } from './adapters/tokens/ccusage-token-provider.js';
import { CompositeSkillSource } from './app/inventory/composite-skill-source.js';
import type { AiReviewer, SessionActivitySource } from './core/ports/review.js';
import type { EngineFactory, RepoMetadataProvider } from './core/ports/search.js';
import type { SkillSource } from './core/ports/skills.js';
import type { TokenUsageProvider } from './core/ports/tokens.js';
import { LegacyLogSource } from './adapters/claude/history/legacy-log-source.js';
import { TranscriptOverheadSource } from './adapters/claude/history/overhead-source.js';
import { TranscriptActivitySource } from './adapters/claude/history/transcript-activity-source.js';
import { TranscriptSource } from './adapters/claude/history/transcript-source.js';
import { ClaudeCliReviewer } from './adapters/claude/review/claude-cli-reviewer.js';
import { JsonConfigStore } from './adapters/storage/json-config-store.js';
import { JsonlEventStore } from './adapters/storage/jsonl-event-store.js';
import { FileHookRunnerStore } from './adapters/storage/file-hook-runner-store.js';
import { AtomicFileWriter } from './adapters/storage/atomic-file-writer.js';
import { ChartJsAsset } from './adapters/system/chartjs-asset.js';
import { DetachedRunner } from './adapters/system/detached-runner.js';
import { FileSpendRollupStore } from './adapters/storage/spend-rollup-file.js';
import { SystemOpener } from './adapters/system/system-opener.js';
import { FileLogger } from './adapters/system/file-logger.js';
import { NodeFileProbe } from './adapters/system/node-file-probe.js';
import { NodeProcessRunner } from './adapters/system/node-process-runner.js';
import { resolvePaths } from './adapters/system/paths.js';
import { disabledPluginNames } from './core/domain/plugin-state.js';
import { SystemClock } from './adapters/system/system-clock.js';
import type { ClaudeSettingsManager } from './core/ports/claude-settings.js';
import type { HookRunnerStore } from './core/ports/install.js';
import type {
  Cache,
  HttpClient,
  SecretResolver,
  Clock,
  ConfigStore,
  FileProbe,
  FileWriter,
  Logger,
  Opener,
  Paths,
  ProcessRunner,
  ScriptAsset,
  SpendRollupStore,
  BackgroundRunner,
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
  /** Where `init` saves the cclens command line for the plugin's hook script. */
  readonly hookRunner: HookRunnerStore;
  readonly legacySource: UsageHistorySource;
  readonly transcriptSource: UsageHistorySource;
  /** All installed skills: personal, project and plugin (Composite). */
  readonly skillSource: SkillSource;
  readonly tokens: TokenUsageProvider;
  /** Per-session prompts and compactions from transcripts. */
  readonly activitySource: SessionActivitySource;
  /** Second-opinion reviewer behind `cclens review --ai` (headless Claude Code). */
  readonly aiReviewer: AiReviewer;
  readonly cache: Cache;
  readonly http: HttpClient;
  readonly secrets: SecretResolver;
  /** Builds search engines from config entries. */
  readonly engineFactory: EngineFactory;
  /** Adds GitHub stars to results from engines that lack them. */
  readonly repoMetadata: RepoMetadataProvider;
  /** Shell command that starts this cclens CLI; written into Claude Code hooks. */
  readonly selfCommand: string;
  readonly nodeVersion: string;
  /** All installed agents: personal, project and plugin (Composite). */
  readonly agentSource: AgentSource;
  /** Subagent runs and Agent calls from transcripts. */
  readonly agentActivity: AgentActivitySource;
  readonly overhead: ContextOverheadSource;
  /** Model prices for per-message agent costs (LiteLLM list, cached a day). */
  readonly prices: PriceList;
  /** Writes files the user asked for (`cclens report --out`). */
  readonly fileWriter: FileWriter;
  /** Opens a report in the default browser (`--open`). */
  readonly opener: Opener;
  /** Chart.js source, inlined into HTML reports. */
  readonly chartScript: ScriptAsset;
  /** Today's and this month's spend, read by the hook and status line. */
  readonly spendStore: SpendRollupStore;
  /** Starts `cclens budget refresh` in the background. */
  readonly background: BackgroundRunner;
}

export interface ContainerOptions {
  readonly env?: NodeJS.ProcessEnv;
  readonly cwd?: string;
  readonly verbose?: boolean;
  /** cclens version, sent as the HTTP User-Agent. */
  readonly version?: string;
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
  const env = options.env ?? process.env;
  const runner = new NodeProcessRunner();
  const cache = o.cache ?? new FileCache(paths.cacheDir, clock);
  const http = o.http ?? new FetchHttpClient(`cclens/${options.version ?? 'dev'}`);
  const secrets = o.secrets ?? new EnvSecretResolver(env, runner);
  const settings = new JsonSettingsManager(
    paths.claudeHome,
    options.cwd ?? process.cwd(),
    paths.backupsDir,
    clock,
  );
  // Plugins turned off with `claude plugin disable` stay on disk; leave their skills and
  // agents out. Unreadable settings count as nothing disabled.
  const switches = async (scope: 'user' | 'project') => ({
    enabled: await settings.enabledPlugins(scope),
    disabled: await settings.disabledPlugins(scope),
  });
  const disabledPlugins = async (): Promise<ReadonlySet<string>> => {
    try {
      return disabledPluginNames(await switches('user'), await switches('project'));
    } catch {
      return new Set();
    }
  };
  return {
    paths,
    clock,
    logger,
    processRunner: runner,
    files: new NodeFileProbe(),
    configStore: new JsonConfigStore(paths.configFile),
    eventStore: new JsonlEventStore(paths.eventsFile, logger),
    settings,
    hookRunner: new FileHookRunnerStore(paths.hookRunnerFile),
    legacySource: new LegacyLogSource(paths.legacyUsageLog),
    transcriptSource: new TranscriptSource(paths.claudeProjectsDir, logger),
    skillSource: new CompositeSkillSource([
      new SkillDirSource('personal', paths.claudeSkillsDir, 'personal'),
      new SkillDirSource(
        'project',
        join(options.cwd ?? process.cwd(), '.claude', 'skills'),
        'project',
      ),
      new PluginTreeSource(paths.pluginRoots, undefined, disabledPlugins),
    ]),
    tokens: new CcusageTokenProvider(runner, {
      command: [process.execPath, ccusageCliPath()],
    }),
    activitySource: new TranscriptActivitySource(paths.claudeProjectsDir, logger),
    cache,
    http,
    secrets,
    engineFactory: new DefaultEngineFactory({ http, secrets }),
    repoMetadata: new GithubMetadataProvider(http, secrets, cache),
    aiReviewer: new ClaudeCliReviewer(runner, { command: env['CCLENS_CLAUDE_BIN'] ?? 'claude' }),
    selfCommand: o.selfCommand ?? defaultSelfCommand(options.env),
    nodeVersion: process.version,
    agentSource: new CompositeAgentSource([
      new AgentDirSource('personal', join(paths.claudeHome, 'agents'), 'personal'),
      new AgentDirSource(
        'project',
        join(options.cwd ?? process.cwd(), '.claude', 'agents'),
        'project',
      ),
      new PluginAgentSource(paths.pluginRoots, undefined, disabledPlugins),
    ]),
    agentActivity: new TranscriptAgentSource(paths.claudeProjectsDir, logger),
    overhead: new TranscriptOverheadSource(paths.claudeProjectsDir, logger),
    prices: new LiteLlmPriceList(http, cache),
    fileWriter: new AtomicFileWriter(),
    opener: new SystemOpener(runner),
    chartScript: new ChartJsAsset(),
    spendStore: new FileSpendRollupStore(paths.spendFile),
    background: new DetachedRunner(),
    ...o,
  };
}

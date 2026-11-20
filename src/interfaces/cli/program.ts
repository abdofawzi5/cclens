import { Command } from 'commander';
import { AdviseService } from '../../app/advise-service.js';
import { AgentService } from '../../app/agent-service.js';
import { BudgetService } from '../../app/budget-service.js';
import { ContextService } from '../../app/context-service.js';
import { ConfigService } from '../../app/config-service.js';
import { DoctorService } from '../../app/doctor-service.js';
import { InventoryService } from '../../app/inventory/inventory-service.js';
import { JobService } from '../../app/job-service.js';
import { ReportService } from '../../app/report-service.js';
import { ReviewService } from '../../app/review-service.js';
import { EngineService } from '../../app/search/engine-service.js';
import { SearchService } from '../../app/search/search-service.js';
import { SetupService } from '../../app/setup-service.js';
import { TokenService } from '../../app/token-service.js';
import { UsageService } from '../../app/usage-service.js';
import type { Container } from '../../composition-root.js';
import { defaultRules } from '../../core/rules/index.js';
import { JsonRenderer } from '../render/json-renderer.js';
import type { CliCommand, CommandContext, Services } from './command.js';
import { AdviseCommand } from './commands/advise-command.js';
import { AgentsCommand } from './commands/agents-command.js';
import { BudgetCommand } from './commands/budget-command.js';
import { ContextCommand } from './commands/context-command.js';
import { ConfigCommand } from './commands/config-command.js';
import { DoctorCommand } from './commands/doctor-command.js';
import { HookCommand } from './commands/hook-command.js';
import { InitCommand } from './commands/init-command.js';
import { JobsCommand } from './commands/jobs-command.js';
import { ReportCommand } from './commands/report-command.js';
import { ReviewCommand } from './commands/review-command.js';
import { EnginesCommand } from './commands/engines-command.js';
import { SearchCommand } from './commands/search-command.js';
import { PathsCommand } from './commands/paths-command.js';
import { SkillsCommand } from './commands/skills-command.js';
import { StatuslineCommand } from './commands/statusline-command.js';
import { TokensCommand } from './commands/tokens-command.js';
import { UiCommand } from './commands/ui-command.js';
import { UninstallCommand } from './commands/uninstall-command.js';
import { UsageCommand } from './commands/usage-command.js';

/** Registered commands. New phases add their command class here. */
const COMMANDS: readonly CliCommand[] = [
  new SkillsCommand(),
  new UsageCommand(),
  new TokensCommand(),
  new AdviseCommand(),
  new ReviewCommand(),
  new ReportCommand(),
  new UiCommand(),
  new ContextCommand(),
  new AgentsCommand(),
  new JobsCommand(),
  new BudgetCommand(),
  new StatuslineCommand(),
  new SearchCommand(),
  new EnginesCommand(),
  new InitCommand(),
  new DoctorCommand(),
  new UninstallCommand(),
  new PathsCommand(),
  new ConfigCommand(),
  new HookCommand(),
];

export function buildServices(c: Container): Services {
  const usage = new UsageService(c.eventStore, c.clock);
  const config = new ConfigService(c.configStore);
  const search = new SearchService({
    config,
    factory: c.engineFactory,
    cache: c.cache,
    clock: c.clock,
    metadata: c.repoMetadata,
    skills: c.skillSource,
  });
  const review = new ReviewService({
    config,
    skills: c.skillSource,
    usage,
    tokens: c.tokens,
    activity: c.activitySource,
    clock: c.clock,
    rules: defaultRules(),
    ai: c.aiReviewer,
    agents: c.agentSource,
    agentActivity: c.agentActivity,
    overhead: c.overhead,
  });
  const inventory = new InventoryService(c.skillSource, usage, {
    settings: c.settings,
    claudeHome: c.paths.claudeHome,
    overhead: c.overhead,
  });
  const context = new ContextService(c.overhead, c.clock);
  const budget = new BudgetService({
    config,
    store: c.spendStore,
    tokens: c.tokens,
    usage,
    clock: c.clock,
    background: c.background,
  });
  return {
    config,
    usage,
    inventory,
    tokens: new TokenService(c.tokens, c.activitySource),
    search,
    engines: new EngineService(config, c.engineFactory, search),
    review,
    report: new ReportService(review),
    agents: new AgentService({
      agents: c.agentSource,
      activity: c.agentActivity,
      tokens: c.tokens,
      prices: c.prices,
      sessions: c.activitySource,
    }),
    jobs: new JobService(c.tokens, c.activitySource, c.clock),
    budget,
    context,
    advise: new AdviseService({ review, context, inventory, search, budget }),
    setup: new SetupService({
      paths: c.paths,
      configStore: c.configStore,
      eventStore: c.eventStore,
      settings: c.settings,
      hookRunner: c.hookRunner,
      usage,
      legacySource: c.legacySource,
      transcriptSource: c.transcriptSource,
      selfCommand: c.selfCommand,
    }),
    doctor: new DoctorService({
      paths: c.paths,
      configStore: c.configStore,
      settings: c.settings,
      hookRunner: c.hookRunner,
      usage,
      files: c.files,
      nodeVersion: c.nodeVersion,
      spend: c.spendStore,
      clock: c.clock,
    }),
  };
}

export function buildProgram(
  container: Container,
  version: string,
  print: (text: string) => void = (t) => {
    process.stdout.write(`${t}\n`);
  },
): Command {
  const program = new Command()
    .name('cclens')
    .description('Claude Code Lens: skills, usage, tokens, optimization tips and skill search')
    .version(version)
    .option('--json', 'machine-readable JSON output')
    // Read and removed from argv by main.ts (dir-flags.ts); listed here for --help.
    .option('--claude-dir <dir>', 'read only this Claude Code config dir (default ~/.claude)')
    .option('--cclens-home <dir>', 'keep cclens data in this dir (default ~/.cclens)')
    .showHelpAfterError();

  const json = new JsonRenderer();
  const ctx: CommandContext = {
    container,
    services: buildServices(container),
    renderer: (format, fallback) => (format === 'json' ? json : fallback),
    print,
  };

  for (const command of COMMANDS) command.register(program, ctx);
  return program;
}

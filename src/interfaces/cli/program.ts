import { Command } from 'commander';
import { ConfigService } from '../../app/config-service.js';
import { DoctorService } from '../../app/doctor-service.js';
import { InventoryService } from '../../app/inventory/inventory-service.js';
import { SetupService } from '../../app/setup-service.js';
import { TokenService } from '../../app/token-service.js';
import { UsageService } from '../../app/usage-service.js';
import type { Container } from '../../composition-root.js';
import { JsonRenderer } from '../render/json-renderer.js';
import type { CliCommand, CommandContext, Services } from './command.js';
import { ConfigCommand } from './commands/config-command.js';
import { DoctorCommand } from './commands/doctor-command.js';
import { HookCommand } from './commands/hook-command.js';
import { InitCommand } from './commands/init-command.js';
import { PathsCommand } from './commands/paths-command.js';
import { SkillsCommand } from './commands/skills-command.js';
import { TokensCommand } from './commands/tokens-command.js';
import { UninstallCommand } from './commands/uninstall-command.js';
import { UsageCommand } from './commands/usage-command.js';

/** Registered commands. New phases add their command class here. */
const COMMANDS: readonly CliCommand[] = [
  new SkillsCommand(),
  new UsageCommand(),
  new TokensCommand(),
  new InitCommand(),
  new DoctorCommand(),
  new UninstallCommand(),
  new PathsCommand(),
  new ConfigCommand(),
  new HookCommand(),
];

export function buildServices(c: Container): Services {
  const usage = new UsageService(c.eventStore, c.clock);
  return {
    config: new ConfigService(c.configStore),
    usage,
    inventory: new InventoryService(c.skillSource, usage),
    tokens: new TokenService(c.tokens),
    setup: new SetupService({
      paths: c.paths,
      configStore: c.configStore,
      eventStore: c.eventStore,
      settings: c.settings,
      usage,
      legacySource: c.legacySource,
      transcriptSource: c.transcriptSource,
      selfCommand: c.selfCommand,
    }),
    doctor: new DoctorService({
      paths: c.paths,
      configStore: c.configStore,
      settings: c.settings,
      usage,
      files: c.files,
      nodeVersion: c.nodeVersion,
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

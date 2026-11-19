import { Command } from 'commander';
import { ConfigService } from '../../app/config-service.js';
import type { Container } from '../../composition-root.js';
import { JsonRenderer } from '../render/json-renderer.js';
import type { CliCommand, CommandContext } from './command.js';
import { ConfigCommand } from './commands/config-command.js';
import { PathsCommand } from './commands/paths-command.js';

/** Registered commands. New phases add their command class here. */
const COMMANDS: readonly CliCommand[] = [new PathsCommand(), new ConfigCommand()];

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
    services: { config: new ConfigService(container.configStore) },
    renderer: (format, fallback) => (format === 'json' ? json : fallback),
    print,
  };

  for (const command of COMMANDS) command.register(program, ctx);
  return program;
}

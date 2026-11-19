import type { Command } from 'commander';
import type { ConfigService } from '../../app/config-service.js';
import type { Container } from '../../composition-root.js';
import type { OutputFormat, Renderer } from '../render/renderer.js';

/** What every CLI command receives. Built once in main.ts. */
export interface CommandContext {
  readonly container: Container;
  readonly services: { readonly config: ConfigService };
  /** Picks the renderer for the format the user asked for. */
  renderer(format: OutputFormat, fallback: Renderer): Renderer;
  print(text: string): void;
}

/** A self-registering CLI command (one class per command keeps main.ts closed for change). */
export interface CliCommand {
  register(program: Command, ctx: CommandContext): void;
}

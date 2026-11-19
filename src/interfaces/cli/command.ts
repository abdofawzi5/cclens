import type { Command } from 'commander';
import type { ConfigService } from '../../app/config-service.js';
import type { DoctorService } from '../../app/doctor-service.js';
import type { ReviewService } from '../../app/review-service.js';
import type { EngineService } from '../../app/search/engine-service.js';
import type { SearchService } from '../../app/search/search-service.js';
import type { InventoryService } from '../../app/inventory/inventory-service.js';
import type { SetupService } from '../../app/setup-service.js';
import type { TokenService } from '../../app/token-service.js';
import type { UsageService } from '../../app/usage-service.js';
import type { Container } from '../../composition-root.js';
import type { OutputFormat, Renderer } from '../render/renderer.js';

export interface Services {
  readonly config: ConfigService;
  readonly usage: UsageService;
  readonly inventory: InventoryService;
  readonly tokens: TokenService;
  readonly review: ReviewService;
  readonly search: SearchService;
  readonly engines: EngineService;
  readonly setup: SetupService;
  readonly doctor: DoctorService;
}

/** What every CLI command receives. Built once in program.ts. */
export interface CommandContext {
  readonly container: Container;
  readonly services: Services;
  /** Picks the renderer for the format the user asked for. */
  renderer(format: OutputFormat, fallback: Renderer): Renderer;
  print(text: string): void;
}

/** A self-registering CLI command (one class per command keeps program.ts closed for change). */
export interface CliCommand {
  register(program: Command, ctx: CommandContext): void;
}

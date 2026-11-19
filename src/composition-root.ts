import { FileLogger } from './adapters/system/file-logger.js';
import { NodeProcessRunner } from './adapters/system/node-process-runner.js';
import { resolvePaths } from './adapters/system/paths.js';
import { SystemClock } from './adapters/system/system-clock.js';
import { JsonConfigStore } from './adapters/storage/json-config-store.js';
import type {
  Clock,
  ConfigStore,
  Logger,
  Paths,
  ProcessRunner,
} from './core/ports/infrastructure.js';

/**
 * Every dependency the application needs, typed by port.
 * Grows phase by phase (usage store, token provider, engines…).
 */
export interface Container {
  readonly paths: Paths;
  readonly clock: Clock;
  readonly logger: Logger;
  readonly processRunner: ProcessRunner;
  readonly configStore: ConfigStore;
}

export interface ContainerOptions {
  readonly env?: NodeJS.ProcessEnv;
  readonly verbose?: boolean;
  /** Replace any dependency, e.g. with fakes in tests. */
  readonly overrides?: Partial<Container>;
}

/** The only place concrete adapters are instantiated. */
export function createContainer(options: ContainerOptions = {}): Container {
  const paths = options.overrides?.paths ?? resolvePaths(options.env);
  return {
    paths,
    clock: new SystemClock(),
    logger: new FileLogger(paths.hookErrorLog, options.verbose ?? false),
    processRunner: new NodeProcessRunner(),
    configStore: new JsonConfigStore(paths.configFile),
    ...options.overrides,
  };
}

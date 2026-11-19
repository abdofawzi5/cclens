import { engineConfigSchema, type EngineConfig } from '../../core/config/schema.js';
import type { EngineDescriptor, EngineOutcome } from '../../core/domain/search.js';
import { ConfigError, EngineError, ValidationError } from '../../core/errors.js';
import type { EngineFactory } from '../../core/ports/search.js';
import type { ConfigService } from '../config-service.js';
import type { SearchService } from './search-service.js';

export interface EngineRow {
  readonly config: EngineConfig;
  readonly descriptor?: EngineDescriptor;
}

/** Use cases behind `cclens engines`: list, enable, disable, add, remove, test. */
export class EngineService {
  constructor(
    private readonly config: ConfigService,
    private readonly factory: EngineFactory,
    private readonly search: SearchService,
  ) {}

  async list(): Promise<readonly EngineRow[]> {
    return (await this.config.engines()).map((config) => {
      try {
        return { config, descriptor: this.factory.create(config).descriptor };
      } catch {
        return { config };
      }
    });
  }

  setEnabled(id: string, enabled: boolean): Promise<EngineConfig> {
    return this.config.setEngineEnabled(id, enabled);
  }

  /** Adds an engine from a JSON definition (usually `generic-http`). */
  async add(definition: unknown): Promise<EngineConfig> {
    const parsed = engineConfigSchema.safeParse(definition);
    if (!parsed.success) {
      const issues = parsed.error.issues.map(
        (i) => `${i.path.join('.') || '(root)'}: ${i.message}`,
      );
      throw new ConfigError(`Invalid engine definition:\n  ${issues.join('\n  ')}`);
    }
    const engine = parsed.data;
    const config = await this.config.load();
    if (config.engines.some((e) => e.id === engine.id)) {
      throw new ValidationError(`An engine with id "${engine.id}" already exists.`);
    }
    this.factory.create(engine);
    await this.config.save({ ...config, engines: [...config.engines, engine] });
    return engine;
  }

  async remove(id: string): Promise<void> {
    const config = await this.config.load();
    if (!config.engines.some((e) => e.id === id)) {
      throw new EngineError(id, `Unknown engine "${id}".`, { unknown: true });
    }
    await this.config.save({ ...config, engines: config.engines.filter((e) => e.id !== id) });
  }

  /** Runs a small live query against engines (all enabled when `id` is omitted), bypassing the cache. */
  async test(id?: string, text = 'seo'): Promise<readonly EngineOutcome[]> {
    const report = await this.search.search(text, {
      limit: 3,
      refresh: true,
      ...(id ? { engines: [id] } : {}),
    });
    return report.outcomes;
  }
}

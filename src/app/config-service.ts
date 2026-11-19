import type { CclensConfig, EngineConfig } from '../core/config/schema.js';
import { EngineError } from '../core/errors.js';
import type { ConfigStore } from '../core/ports/infrastructure.js';

/** Use cases around the user's cclens configuration. */
export class ConfigService {
  constructor(private readonly store: ConfigStore) {}

  get path(): string {
    return this.store.path;
  }

  load(): Promise<CclensConfig> {
    return this.store.load();
  }

  save(config: CclensConfig): Promise<void> {
    return this.store.save(config);
  }

  async engines(): Promise<readonly EngineConfig[]> {
    return (await this.store.load()).engines;
  }

  async setEngineEnabled(id: string, enabled: boolean): Promise<EngineConfig> {
    const config = await this.store.load();
    const engine = config.engines.find((e) => e.id === id);
    if (!engine) {
      const known = config.engines.map((e) => e.id).join(', ');
      throw new EngineError(id, `Unknown engine "${id}". Known engines: ${known}`, {
        unknown: true,
      });
    }
    const updated = { ...engine, enabled };
    await this.store.save({
      ...config,
      engines: config.engines.map((e) => (e.id === id ? updated : e)),
    });
    return updated;
  }
}

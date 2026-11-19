import { defaultConfig } from '../../src/core/config/defaults.js';
import { parseConfig } from '../../src/core/config/parse.js';
import type { CclensConfig } from '../../src/core/config/schema.js';
import type { ConfigStore } from '../../src/core/ports/infrastructure.js';

export class InMemoryConfigStore implements ConfigStore {
  readonly path = '/virtual/config.json';
  saved: CclensConfig | undefined;

  constructor(private config: CclensConfig = defaultConfig()) {}

  exists(): Promise<boolean> {
    return Promise.resolve(this.saved !== undefined);
  }

  load(): Promise<CclensConfig> {
    return Promise.resolve(structuredClone(this.config));
  }

  save(config: CclensConfig): Promise<void> {
    this.config = parseConfig(config);
    this.saved = this.config;
    return Promise.resolve();
  }
}

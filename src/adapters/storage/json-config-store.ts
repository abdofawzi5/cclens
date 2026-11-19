import { readFile, access } from 'node:fs/promises';
import { defaultConfig } from '../../core/config/defaults.js';
import { parseConfig } from '../../core/config/parse.js';
import type { CclensConfig } from '../../core/config/schema.js';
import { ConfigError } from '../../core/errors.js';
import type { ConfigStore } from '../../core/ports/infrastructure.js';
import { writeFileAtomic } from './atomic-write.js';

export class JsonConfigStore implements ConfigStore {
  constructor(readonly path: string) {}

  async exists(): Promise<boolean> {
    try {
      await access(this.path);
      return true;
    } catch {
      return false;
    }
  }

  async load(): Promise<CclensConfig> {
    let text: string;
    try {
      text = await readFile(this.path, 'utf8');
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code === 'ENOENT') return defaultConfig();
      throw new ConfigError(`Cannot read ${this.path}`, { cause, io: true });
    }
    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch (cause) {
      throw new ConfigError(`${this.path} is not valid JSON`, { cause });
    }
    return parseConfig(raw);
  }

  async save(config: CclensConfig): Promise<void> {
    const valid = parseConfig(config);
    await writeFileAtomic(this.path, `${JSON.stringify(valid, null, 2)}\n`);
  }
}

import { ConfigError } from '../errors.js';
import { configSchema, type CclensConfig } from './schema.js';

/**
 * Validates raw config data. Migrations for future versions plug in here,
 * keyed by `version`, before the schema parse.
 */
export function parseConfig(raw: unknown): CclensConfig {
  const result = configSchema.safeParse(raw);
  if (!result.success) {
    const issues = result.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`);
    throw new ConfigError(`Invalid cclens config:\n  - ${issues.join('\n  - ')}`);
  }
  return result.data;
}

import { CONFIG_VERSION, configSchema, type CclensConfig } from './schema.js';

/** Config written by `cclens init`. Every field has a schema default; this lists engines. */
export function defaultConfig(): CclensConfig {
  return configSchema.parse({
    version: CONFIG_VERSION,
    engines: [
      { id: 'github', type: 'github' },
      { id: 'skillsmp', type: 'skillsmp' },
      { id: 'skillssh', type: 'skillssh' },
    ],
  });
}

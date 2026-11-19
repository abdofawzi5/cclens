import type { EngineConfig } from '../../core/config/schema.js';
import { EngineError } from '../../core/errors.js';
import type { HttpClient, SecretResolver } from '../../core/ports/infrastructure.js';
import type { EngineFactory, SkillSearchEngine } from '../../core/ports/search.js';
import { GenericHttpEngine } from './generic-http/generic-http-engine.js';
import { GithubEngine } from './github/github-engine.js';
import { SkillsMpEngine } from './skillsmp/skillsmp-engine.js';
import { SkillsShEngine } from './skillssh/skillssh-engine.js';

export interface EngineDeps {
  readonly http: HttpClient;
  readonly secrets: SecretResolver;
}

type Builder<T extends EngineConfig['type']> = (
  config: Extract<EngineConfig, { type: T }>,
  deps: EngineDeps,
) => SkillSearchEngine;

/** One builder per engine type. Adding a registry type means adding one entry here. */
const BUILDERS: { [T in EngineConfig['type']]: Builder<T> } = {
  github: (c, d) =>
    new GithubEngine(d.http, d.secrets, {
      id: c.id,
      qualifiers: c.qualifiers,
      ...(c.token ? { token: c.token } : {}),
    }),
  skillsmp: (c, d) =>
    new SkillsMpEngine(d.http, d.secrets, {
      id: c.id,
      baseUrl: c.baseUrl,
      ...(c.apiKey ? { apiKey: c.apiKey } : {}),
    }),
  skillssh: (c, d) => new SkillsShEngine(d.http, { id: c.id, baseUrl: c.baseUrl }),
  'generic-http': (c, d) => new GenericHttpEngine(d.http, d.secrets, c),
};

/** Registry-backed EngineFactory (Factory + Registry patterns). */
export class DefaultEngineFactory implements EngineFactory {
  readonly types = Object.keys(BUILDERS);

  constructor(private readonly deps: EngineDeps) {}

  create(config: EngineConfig): SkillSearchEngine {
    const build = BUILDERS[config.type] as Builder<EngineConfig['type']> | undefined;
    if (!build) {
      throw new EngineError(
        config.id,
        `Unknown engine type "${String((config as { type: unknown }).type)}"`,
      );
    }
    return build(config, this.deps);
  }
}

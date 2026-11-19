import { z } from 'zod';

export const CONFIG_VERSION = 1 as const;

const engineBase = {
  id: z.string().regex(/^[a-z0-9][a-z0-9-]*$/, 'lowercase letters, digits and dashes'),
  enabled: z.boolean().default(true),
  timeoutMs: z.number().int().positive().max(60_000).default(8_000),
  cacheTtlSeconds: z.number().int().nonnegative().default(3_600),
};

/** `${env:NAME}` placeholders are resolved at runtime, so secrets never live in the file. */
const secretRef = z
  .string()
  .regex(/^\$\{env:[A-Z_][A-Z0-9_]*\}$/, 'use ${env:VAR_NAME}; never store secrets in config');

const githubEngine = z.object({
  ...engineBase,
  type: z.literal('github'),
  /** Extra qualifiers appended to the GitHub search, e.g. `topic:claude-skills`. */
  qualifiers: z.string().default('claude skill'),
  token: secretRef.optional(),
});

const skillsMpEngine = z.object({
  ...engineBase,
  type: z.literal('skillsmp'),
  baseUrl: z.url().default('https://skillsmp.com/api/v1'),
  apiKey: secretRef.optional(),
});

const skillsShEngine = z.object({
  ...engineBase,
  type: z.literal('skillssh'),
  baseUrl: z.url().default('https://skills.sh'),
});

/** Declarative engine: lets users add a registry with JSON only. */
const genericHttpEngine = z.object({
  ...engineBase,
  type: z.literal('generic-http'),
  name: z.string().min(1),
  request: z.object({
    /** May contain `{query}` and `{limit}` placeholders. */
    url: z.string().regex(/^https:\/\//, 'must be an https URL'),
    /** Header values may use `${env:VAR}` references for keys. */
    headers: z.record(z.string(), z.string()).default({}),
  }),
  response: z.object({
    /** Dot path to the results array, e.g. `data.skills`. */
    items: z.string().min(1),
    map: z.object({
      name: z.string(),
      url: z.string(),
      description: z.string().optional(),
      repoUrl: z.string().optional(),
      stars: z.string().optional(),
      installs: z.string().optional(),
    }),
  }),
});

export { secretRef };

export const engineConfigSchema = z.discriminatedUnion('type', [
  githubEngine,
  skillsMpEngine,
  skillsShEngine,
  genericHttpEngine,
]);

export const configSchema = z.object({
  version: z.literal(CONFIG_VERSION),
  engines: z
    .array(engineConfigSchema)
    .refine(
      (list) => new Set(list.map((e) => e.id)).size === list.length,
      'engine ids must be unique',
    ),
  search: z
    .object({
      defaultLimit: z.number().int().min(1).max(100).default(20),
      defaultSort: z.enum(['stars', 'relevance', 'installs', 'updated']).default('stars'),
      minStars: z.number().int().nonnegative().default(0),
    })
    .prefault({}),
  review: z
    .object({
      windowDays: z.number().int().min(1).max(365).default(30),
      disabledRules: z.array(z.string()).default([]),
    })
    .prefault({}),
  /** Spending limits in USD at API list prices; off until set (`cclens budget set`). */
  budget: z
    .object({
      daily: z.number().positive().optional(),
      monthly: z.number().positive().optional(),
      warnAt: z.number().int().min(1).max(100).default(100),
    })
    .prefault({}),
});

export type EngineConfig = z.infer<typeof engineConfigSchema>;
export type CclensConfig = z.infer<typeof configSchema>;

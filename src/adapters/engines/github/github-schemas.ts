import { z } from 'zod';

/** Fields cclens uses from GitHub's repository objects (search items and GET /repos). */
export const githubRepo = z.looseObject({
  full_name: z.string(),
  name: z.string(),
  owner: z.looseObject({ login: z.string() }),
  html_url: z.string(),
  description: z.string().nullish(),
  stargazers_count: z.number(),
  topics: z.array(z.string()).default([]),
  pushed_at: z.iso.datetime().nullish(),
  archived: z.boolean().default(false),
  license: z.looseObject({ spdx_id: z.string().nullish() }).nullish(),
});

export const githubSearch = z.looseObject({ items: z.array(githubRepo) });

export type GithubRepo = z.infer<typeof githubRepo>;

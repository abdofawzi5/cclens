# ADR 0003: Skill search engines and how each is accessed

- Status: accepted
- Date: 2026-11-19 (all endpoints verified live on this date)

## Findings

| Engine                              | Endpoint                                                               | Auth                                                         | Returns                                                                            | Stars |
| ----------------------------------- | ---------------------------------------------------------------------- | ------------------------------------------------------------ | ---------------------------------------------------------------------------------- | ----- |
| **SkillsMP**                        | `GET https://skillsmp.com/api/v1/skills/search?q=&limit=&sortBy=stars` | none needed (key optional)                                   | name, author, description, githubUrl, skillUrl, **stars**, updatedAt, pagination   | yes   |
| **skills.sh v1** (documented)       | `GET https://skills.sh/api/v1/skills/search`                           | **required**: Vercel OIDC bearer token (HTTP 401 without it) | not inspected                                                                      | n/a   |
| **skills.sh public** (undocumented) | `GET https://skills.sh/api/search?q=&limit=`                           | none                                                         | id, source (`owner/repo`), skillId, name, **installs**                             | no    |
| **GitHub**                          | `GET https://api.github.com/search/repositories?q=&sort=stars`         | token optional (60 → 5,000 req/h with `gh auth token`)       | full_name, description, **stargazers_count**, topics, pushed_at, archived, license | yes   |

## Decision

- **SkillsMP**: enabled by default, official endpoint, anonymous.
- **GitHub**: enabled by default. Repository search with `claude skill` qualifiers. Also the `RepoMetadataProvider` that adds stars to results from engines without them (skills.sh). The token is resolved from `${env:GITHUB_TOKEN}` or `gh auth token`, never stored.
- **skills.sh**: enabled by default using the **public endpoint**, marked `stability: "unofficial"` and labelled as such in output. The documented v1 API is not supported: it needs a Vercel OIDC token that end users do not have, and its response shape could not be checked.
- **generic-http**: a declarative engine type so users can add registries with JSON only.
- Every engine runs behind Timeout and Cache decorators via `Promise.allSettled`; a failing engine becomes a warning in the report, never a command failure.
- Only the search text is sent. No user data, paths or usage stats leave the machine.

## Merging and ranking (Phase 4)

- Results merge by repository, by skill name within a repository, or by URL. Translated copies of one skill (SkillsMP lists several languages) merge into one, and English text wins.
- Sorting by stars alone put skills from huge, loosely related monorepos on top. Every sort therefore first groups results by how many query words they mention (name, path, repository, description), then applies stars, installs, update time or relevance.
- Results without stars (skills.sh) get them from `GET /repos/{owner}/{repo}`, cached for a day, at most 30 repositories per search.
- Each engine's results are cached per query for its `cacheTtlSeconds` (default 1 hour) in `~/.cclens/cache`; `--refresh` skips the cache.

## Consequences

The unofficial skills.sh endpoint may break without notice; the engine then reports a failure and the other engines still answer. `scripts/verify-apis.mjs` re-checks all endpoints and is run in a scheduled CI job.

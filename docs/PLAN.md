# cclens: Project Plan

> **Claude Code Lens**: see what Claude Code is doing for you. It shows which skills you have, which you use, where your tokens go, and how to use fewer. It also finds new skills across the main skill registries.

Status: **planning**. No code yet. Read with [ARCHITECTURE.md](ARCHITECTURE.md).

---

## 1. Goals

| #   | Requirement                                                                                               | Notes                                                                                              |
| --- | --------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| R1  | **Installed skills inventory**: count and list every skill                                                | Personal (`~/.claude/skills`), project (`.claude/skills`), plugin skills, grouped by source/plugin |
| R2  | **Skill usage counts**: how often each skill is used                                                      | Live capture through a hook, plus backfill from existing transcripts so history isn't lost         |
| R3  | **Token consumption**: per day, week, month, session, project, model                                      | Integrate **ccusage** as a library rather than rewriting the JSONL parsing                         |
| R4  | **Session review and optimization advice**                                                                | Rule-based analyzers (fast, offline) plus an optional AI review through headless `claude -p`       |
| R5  | **Skill discovery search** across registries, ranked by GitHub stars                                      | Pluggable search engines you can enable, disable, or add                                           |
| R6  | **Installable and publishable**: `npm i -g cclens` plus `cclens init`, or install as a Claude Code plugin | `init` creates the data files and registers hooks; `uninstall` reverses it cleanly                 |

### Added requirements (proposed)

| #   | Requirement                                                                                                  | Why                                                                                          |
| --- | ------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------- |
| A1  | **Unused-skill report**: installed but not used in N days                                                    | Each installed skill costs context tokens on every reply. This is the easiest saving to make |
| A2  | **Context overhead breakdown**: tokens taken by MCP tools, skills, and instructions before you type anything | The biggest recurring cost found in your current setup (~33K tokens/reply)                   |
| A3  | **Plan-limit awareness**: 5-hour and weekly windows, burn rate                                               | ccusage already computes session blocks                                                      |
| A4  | **`--json` output on every command**                                                                         | Lets other tools, scripts, and Claude itself use cclens                                      |
| A5  | **Search result install hint**: show the install command for each result                                     | Moves you straight from discovery to use                                                     |
| A6  | **Search caching with a TTL, rate-limit handling, and per-engine timeouts**                                  | Registries are external, so a slow engine must not block the rest                            |
| A7  | **Privacy**: everything local; no telemetry; search sends only the query                                     | User data never leaves the machine                                                           |
| A8  | **`cclens doctor`**: checks hooks, paths, and the data file                                                  | Makes support and debugging easy                                                             |
| A9  | **Migration of the current `~/.claude/skill-usage.log` hook**                                                | Keeps the data you're already collecting                                                     |
| A10 | **Web dashboard (`cclens ui`)**, later phase                                                                 | Charts for daily tokens and top skills                                                       |

### Non-goals (v1)

- No cloud backend or account. Everything runs locally.
- No editing of skills, and no installing them automatically. cclens only suggests the install command.
- No billing reconciliation with Anthropic invoices. Costs are ccusage's estimates.

---

## 2. Reuse instead of rebuilding

| Need                                                     | Use                                                                                                                                                                 | Instead of                                         |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| Token/cost aggregation (daily, monthly, session, blocks) | [`ccusage`](https://www.npmjs.com/package/ccusage) **CLI with `--json`** (v20 no longer exports a library; see [ADR 0002](adr/0002-token-usage-via-ccusage-cli.md)) | Writing our own JSONL token parser and price table |
| Skill registry: SkillsMP                                 | REST `GET https://skillsmp.com/api/v1/skills/search` (anonymous, verified)                                                                                          | Scraping                                           |
| Skill registry: skills.sh                                | Public `GET /api/search` (unofficial, no auth, verified); documented v1 used when a Vercel OIDC token is configured ([ADR 0003](adr/0003-skill-search-engines.md))  | Scraping                                           |
| Star counts / repo metadata                              | GitHub REST API (`/search/repositories`, `/search/code`), with the token taken from `gh auth token` or `GITHUB_TOKEN`                                               | Hard-coding repo lists                             |
| Live usage capture                                       | Claude Code **hooks** (`PostToolUse` matcher `Skill`, `UserPromptSubmit`)                                                                                           | Polling transcripts                                |
| Plugin distribution                                      | Claude Code **plugin + marketplace** manifest in this repo                                                                                                          | Asking users to edit `settings.json` by hand       |
| AI session review                                        | Headless Claude Code `claude -p --output-format json`                                                                                                               | Calling the API with a separate key                |
| CLI framework, validation, tables                        | `commander`, `zod`, `cli-table3` / `picocolors`                                                                                                                     | Hand-rolled argument parsing                       |

All endpoints were verified live in Phase 0. `pnpm verify:apis` re-checks them, and a weekly CI job runs it.

---

## 3. Tech stack

- **TypeScript (strict)**, Node ≥ 20, ESM, **pnpm**
- Build: `tsup` · Tests: `vitest` (unit + contract tests with recorded HTTP fixtures via `msw`) · Lint/format: `eslint` + `prettier`
- Validation: `zod` for config, hook payloads, and every external API response
- Releases: `changesets` → npm; GitHub Actions CI (lint, typecheck, test on macOS/Linux/Windows)

---

## 4. User-facing commands

```
cclens init [--scope user|project] [--backfill]   # create data dir, register hooks, import history
cclens uninstall [--keep-data]                    # remove hooks (restores settings backup)
cclens doctor                                     # verify installation

cclens skills [--source personal|project|plugin] [--unused 30d]
cclens usage  [--since 2026-11-01] [--by skill|day|project]
cclens tokens [daily|weekly|monthly|session|blocks] [--project X]
cclens review [--days 30] [--session <id>|--last] [--rule <id>...] [--ai] [--list-rules]
cclens search <query> [--engine github,skillsmp] [--min-stars 50] [--sort stars|relevance]
cclens engines list | enable <id> | disable <id> | add --from-file engine.json
cclens ui                                         # phase 4

cclens hook <event>          # internal: called by the hooks, reads JSON from stdin
```

Every command accepts `--json`.

---

## 5. Installation design (R6)

There are two supported paths, and both end in the same state.

1. **npm:** `npm i -g cclens` → `cclens init`.
   - Installing deliberately does **not** run a `postinstall` script. pnpm blocks those by default, and changing `settings.json` without asking is bad practice. `init` is explicit and safe to run again.
2. **Claude Code plugin:** `/plugin marketplace add <you>/cclens` → `/plugin install cclens`.
   - The plugin's `hooks/hooks.json` registers the hooks automatically, and a `/cclens` slash command and skill come with it.
   - The hook runs `npx -y cclens hook …`, or the global binary if one is installed.

`init` does the following:

1. Creates the data directory `~/.cclens/` with `config.json` (defaults), `events.jsonl` (usage log), and `cache/`.
2. Backs up `~/.claude/settings.json` to `~/.cclens/backups/settings.<timestamp>.json`.
3. Merges the cclens hooks into the settings without replacing it, and skips any already present.
4. Migrates the existing `~/.claude/hooks/log-skill-usage.sh` log, then removes the old hook entry. It asks first.
5. Optionally backfills skill usage from existing transcripts (`--backfill`).
6. Runs `doctor` and prints a summary.

---

## 6. Phases and milestones

| Phase                       | Scope                                                                                                                                                           | Done when                                                                                                                                   |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| **0. Foundations**          | Repo scaffold, tooling, CI, domain types, ports, composition root, config, error model. Verify the external APIs (ccusage exports, SkillsMP, skills.sh, GitHub) | `pnpm test` and CI are green; an ADR is recorded for each external integration                                                              |
| **1. Install and capture**  | `init` / `uninstall` / `doctor`, settings merger, `hook` command, event store, legacy-log migration, transcript backfill                                        | A fresh machine logs a skill use end to end; uninstall restores `settings.json` exactly                                                     |
| **2. Stats**                | `skills` (inventory sources), `usage`, `tokens` (ccusage adapter), renderers (table/json/markdown)                                                              | Numbers match a manual count on fixture data                                                                                                |
| **3. Review**               | Analyzer rules + recommendation engine; `--ai` reviewer through `claude -p`                                                                                     | Each rule has fixture tests; the report lists the estimated tokens each fix would save. Done 2026-11-19 (ADR 0005)                          |
| **4. Search**               | Engine port, GitHub / SkillsMP / skills.sh adapters, generic HTTP engine, aggregator (dedupe + star enrichment + ranking), cache, `engines` command             | Results from all enabled engines merge correctly; turning an engine off works; one engine failing doesn't break the others. Done 2026-11-19 |
| **5. Distribution**         | Plugin manifest + marketplace, README, docs, changesets, npm publish dry run                                                                                    | `npm pack` installs cleanly; plugin install works in a clean Claude Code                                                                    |
| **6. Dashboard** (optional) | `cclens ui`: local web UI over the same services                                                                                                                | Charts render from the same JSON the CLI produces                                                                                           |

---

## 7. Quality bar

- Strict TypeScript, no `any`; all external input validated with zod at the boundary.
- **Ports and adapters**: domain and application code never import `fs`, `fetch`, or `ccusage` directly; only adapters do.
- Every adapter has a contract test; every rule and aggregator has unit tests; at least 90% coverage on `core/`.
- The hook path must finish in **< 150 ms**, never throw, and never block Claude (it always exits 0).
- Settings writes are atomic (write to a temp file, then rename) and always backed up first.
- Conventional commits, changesets, a semver-checked public API.

---

## 8. Open questions

1. **Name**: `cclens` (npm name is free; `skillscope` is taken). Keep it?
2. **skills.sh key**: request one from skills-api@vercel.com, or ship that engine disabled until the user adds a key?
3. **Phase 6 dashboard**: include it in v1, or ship CLI-only first?
4. **Windows support** in v1, or macOS/Linux only?

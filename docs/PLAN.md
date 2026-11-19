# cclens: Project Plan

> **Claude Code Lens**: see what Claude Code is doing for you. It shows which skills you have, which you use, where your tokens go, and how to use fewer. It also finds new skills across the main skill registries.

Status: Phases 0–5 done and 0.1.0 published as `@abdofawzi5/cclens`; Phases 6–12 are planned in section 6.1. Read with [ARCHITECTURE.md](ARCHITECTURE.md).

---

## 1. Goals

| #   | Requirement                                                                                                           | Notes                                                                                              |
| --- | --------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| R1  | **Installed skills inventory**: count and list every skill                                                            | Personal (`~/.claude/skills`), project (`.claude/skills`), plugin skills, grouped by source/plugin |
| R2  | **Skill usage counts**: how often each skill is used                                                                  | Live capture through a hook, plus backfill from existing transcripts so history isn't lost         |
| R3  | **Token consumption**: per day, week, month, session, project, model                                                  | Integrate **ccusage** as a library rather than rewriting the JSONL parsing                         |
| R4  | **Session review and optimization advice**                                                                            | Rule-based analyzers (fast, offline) plus an optional AI review through headless `claude -p`       |
| R5  | **Skill discovery search** across registries, ranked by GitHub stars                                                  | Pluggable search engines you can enable, disable, or add                                           |
| R6  | **Installable and publishable**: `npm i -g @abdofawzi5/cclens` plus `cclens init`, or install as a Claude Code plugin | `init` creates the data files and registers hooks; `uninstall` reverses it cleanly                 |

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

1. **npm:** `npm i -g @abdofawzi5/cclens` → `cclens init`.
   - Installing deliberately does **not** run a `postinstall` script. pnpm blocks those by default, and changing `settings.json` without asking is bad practice. `init` is explicit and safe to run again.
2. **Claude Code plugin:** `/plugin marketplace add <you>/cclens` → `/plugin install cclens`.
   - The plugin's `hooks/hooks.json` registers the hooks automatically, and a `/cclens` slash command and skill come with it.
   - The plugin still needs the CLI: `npm i -g @abdofawzi5/cclens` → `cclens init --plugin`, which saves the absolute command for the plugin's hook script and keeps cclens hooks out of `settings.json` so nothing is counted twice. `npx` was rejected ([ADR 0006](adr/0006-plugin-hook-runner.md)).

`init` does the following:

1. Creates the data directory `~/.cclens/` with `config.json` (defaults), `events.jsonl` (usage log), and `cache/`.
2. Backs up `~/.claude/settings.json` to `~/.cclens/backups/settings.<timestamp>.json`.
3. Merges the cclens hooks into the settings without replacing it, and skips any already present.
4. Migrates the existing `~/.claude/hooks/log-skill-usage.sh` log, then removes the old hook entry. It asks first.
5. Optionally backfills skill usage from existing transcripts (`--backfill`).
6. Runs `doctor` and prints a summary.

---

## 6. Phases and milestones

| Phase                        | Scope                                                                                                                                                           | Done when                                                                                                                                   |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| **0. Foundations**           | Repo scaffold, tooling, CI, domain types, ports, composition root, config, error model. Verify the external APIs (ccusage exports, SkillsMP, skills.sh, GitHub) | `pnpm test` and CI are green; an ADR is recorded for each external integration                                                              |
| **1. Install and capture**   | `init` / `uninstall` / `doctor`, settings merger, `hook` command, event store, legacy-log migration, transcript backfill                                        | A fresh machine logs a skill use end to end; uninstall restores `settings.json` exactly                                                     |
| **2. Stats**                 | `skills` (inventory sources), `usage`, `tokens` (ccusage adapter), renderers (table/json/markdown)                                                              | Numbers match a manual count on fixture data                                                                                                |
| **3. Review**                | Analyzer rules + recommendation engine; `--ai` reviewer through `claude -p`                                                                                     | Each rule has fixture tests; the report lists the estimated tokens each fix would save. Done 2026-11-19 (ADR 0005)                          |
| **4. Search**                | Engine port, GitHub / SkillsMP / skills.sh adapters, generic HTTP engine, aggregator (dedupe + star enrichment + ranking), cache, `engines` command             | Results from all enabled engines merge correctly; turning an engine off works; one engine failing doesn't break the others. Done 2026-11-19 |
| **5. Distribution**          | Plugin manifest + marketplace, README, docs, changesets, npm publish dry run                                                                                    | `npm pack` installs cleanly; plugin install works in a clean Claude Code. Done 2026-11-19 (ADR 0006)                                        |
| **6. Session names**         | Show each session's title (`custom-title`, else first prompt) wherever an ID appears; `review --session` accepts a title                                        | Every session row and finding shows `Title (abcd1234)`; JSON gains `title`. Done 2026-11-19                                                 |
| **7. Reports and charts**    | `cclens report` (markdown, JSON, self-contained HTML with SVG charts); skill tells Claude to chart `--json` output when it can                                  | One HTML file with no network requests; its numbers match `review` and `tokens`                                                             |
| **8. Agents**                | Agent inventory + usage: calls, tokens and estimated cost per agent type; `cclens agents`; `unused-agents` and `expensive-agents` rules                         | Fixture transcripts with subagents give exact counts; unused agents listed like unused skills                                               |
| **9. Recurring jobs**        | Group sessions from the same scheduled or repeated task; cost per run and per month; `cclens jobs`                                                              | Daily scheduled runs show as one job with run count, average and 30-day cost                                                                |
| **10. Live feedback**        | `cclens statusline` (today's cost, 5-hour block) and optional budget warnings                                                                                   | Status line answers in < 100 ms; a budget breach adds one warning line, never blocks                                                        |
| **11. Context overhead**     | A2: tokens taken by MCP tools, skills and CLAUDE.md before the first prompt; `--fix` hints that print disable commands; week-over-week in `review`              | Overhead per source matches a manual count on fixtures                                                                                      |
| **12. Dashboard** (optional) | `cclens ui`: local web UI over the same report model                                                                                                            | Charts render from the same JSON the CLI produces                                                                                           |

---

## 6.1 Roadmap after 0.1.0 (Phases 6–12)

Proposed 2026-11-19 after the first real report showed almost every installed skill unused, the costliest sessions known only by ID, and many repeated scheduled sessions. Each phase is one minor release, keeps the layer rule (`interfaces → app → core ← adapters`), and reads only local files.

### Phase 6: session names (0.2.0), done 2026-11-19

Shipped as planned. Also found: scheduled runs have no typed prompt, so the transcript adapter now registers a session on any user turn (prompts still count only typed ones).

- **Data:** transcripts hold `{"type":"custom-title","customTitle":"…"}` records (the name shown in Claude Code and the desktop app); the last one wins. Without one, use the first typed prompt, cut to 60 characters.
- **Design:** `TranscriptActivitySource` already reads every transcript line once, so it also collects `title` and `titleSource: 'custom' | 'first-prompt'` into `SessionActivity`; no second scan. A small `SessionLabels` value object (core) formats `Title (abcd1234)` and resolves a `--session` argument that is an ID prefix or a title substring (several matches → list them and stop).
- **Where it shows:** `tokens session`, every `review` finding that names a session, `review --session`, and `--json` (`title`, `titleSource`).
- **Tests:** fixtures with a custom title, with only prompts, and with two titles.

### Phase 7: reports and charts (0.3.0)

- **`ReportService` (app)** builds a `UsageReport` model from the existing services: KPI totals, daily tokens and cost, top sessions by cost (with titles), unused skills by plugin, review findings. `cclens report [--since 30d] [--format md|json|html] [--out file] [--open]`.
- **`HtmlReportRenderer` (interfaces)** writes one self-contained file charted with [Chart.js](https://www.chartjs.org/) (MIT, the most used open-source chart library). Chart.js is an npm dependency and its UMD build is inlined into the file, not loaded from a CDN, so the report opens offline and makes no requests (A7). Charts sit behind a `ChartRenderer` interface so the library can be swapped.
- **Inside Claude:** the plugin skill gains a rule: when the user asks for a chart and a chart or visual tool is available, call `cclens … --json` and chart that output; otherwise run `cclens report --format html --open`.
- **Tests:** snapshot of the report model on fixtures; HTML contains no `http` URL except links.

### Phase 8: agents (0.4.0)

- **Inventory:** `AgentSource` port, adapters for `~/.claude/agents`, `.claude/agents` and plugin `agents/` folders (same pattern as the skill sources, `Composite` merge).
- **Usage:** `AgentActivitySource` port; the transcript adapter pairs each `Agent` tool call (`subagent_type`, description) with its sidechain transcript `<session>/subagents/agent-<id>.jsonl` and sums its token counts per model. Each agent gets two cost figures:
  - **priced:** every sidechain message priced by its own model (subagents often run on a cheaper model), using the same LiteLLM price list ccusage uses, fetched through the existing `HttpClient` + `FileCache` (24-hour TTL; only the price list is downloaded, nothing is sent);
  - **share:** the agent's share of its session's tokens and of the session's ccusage cost, so it lines up with `tokens session`.
    When prices can't be loaded (offline, unknown model), the priced column falls back to the share estimate and says so.
- **Command:** `cclens agents [--unused] [--by type|session] [--since 30d]`.
- **Rules:** `unused-agents` (installed agent descriptions cost context too) and `expensive-agents` (one run over a set share of its session's cost).
- **Note:** agent use varies widely between users, so fixtures with many subagents carry the tests.

### Phase 9: recurring jobs (0.5.0)

- **Grouping:** first check transcripts for a scheduled-task marker (to be verified). Otherwise group by normalized title (dates, numbers and episode names stripped) within one project, with at least 3 runs.
- **Output:** `cclens jobs`: runs, average cost per run, 30-day cost and monthly run-rate per job. `review` gains a `recurring-cost` rule pointing at the costliest job and the levers (smaller model, shorter prompt, fewer tools).

### Phase 10: live feedback (0.6.0)

- **Status line:** check first whether `ccusage statusline` already does it (reuse before rebuild); if it does, `cclens statusline` wraps it and adds the skill count. It must answer in under 100 ms, so it reads a small rollup cache instead of running ccusage each time.
- **Budget warnings** (decided 2026-11-19; off until a budget is set):
  - **Setting:** `cclens budget set --daily 50 --monthly 800`, `cclens budget show` (spend so far against each limit), `cclens budget clear`. Stored in `config.budget` (`daily`, `monthly`, `warnAt` default 100%, optional `warnAt: 80` for an early heads-up).
  - **Spend data:** a `SpendRollup` port with a file adapter at `~/.cclens/cache/spend.json` (today's and this month's estimated cost, with a timestamp). `cclens tokens`, `review` and `budget show` refresh it; the hook refreshes it in a detached background process when it is older than 10 minutes, so the hook itself only reads a small file.
  - **Warning:** the `UserPromptSubmit` hook prints one line of hook context when spend passes a limit, e.g. `cclens: today's estimated cost is $71 (daily budget $50)`. At most once per limit per day (state in the rollup file), so it doesn't repeat on every prompt. It never blocks, always exits 0 and stays inside the 150 ms hook budget; the plugin and `init` hooks share the same code.
  - **Wording:** always "estimated" at API list prices, since a subscription plan bills differently.
  - **`init`:** stays non-interactive; it prints one tip line (`cclens budget set --daily <usd>`) when no budget is set.
  - **Doctor:** reports the budget and how old the rollup is.
  - **Tests:** the hook path with a stale, fresh and missing rollup; once-per-day dedupe; the timing test under 150 ms.

### Phase 11: context overhead and fixes (0.7.0)

- **A2 overhead:** tokens before the first prompt, split into MCP tool definitions, skill listing and CLAUDE.md/rules, read from the first request of recent transcripts.
- **`--fix` hints:** `cclens skills --unused --by-plugin --fix` prints the exact `claude plugin disable …` commands (never runs them).
- **Trends:** `review --compare` shows this window against the previous one, so a change can be seen to help.

### Phase 12: dashboard (optional)

`cclens ui` serves the Phase 7 `UsageReport` model from a local-only HTTP server with the same charts and live refresh. It adds no new data, only a view.

### Open questions for these phases

1. ~~Chart drawing~~: decided 2026-11-19: Chart.js, inlined into the HTML file.
2. ~~Agent cost~~: decided 2026-11-19: both, priced per message and share of session (see Phase 8).
3. ~~Scheduled-session marker~~: answered 2026-11-19: yes. A scheduled run starts with a user line whose `origin` is `{"kind":"task-notification","subkind":"scheduled-trigger"}`. Phase 9 groups by that marker plus the title.
4. ~~Budget warnings~~: decided 2026-11-19: added (Phase 10), off until `cclens budget set`.

## 7. Quality bar

- Strict TypeScript, no `any`; all external input validated with zod at the boundary.
- **Ports and adapters**: domain and application code never import `fs`, `fetch`, or `ccusage` directly; only adapters do.
- Every adapter has a contract test; every rule and aggregator has unit tests; at least 90% coverage on `core/`.
- The hook path must finish in **< 150 ms**, never throw, and never block Claude (it always exits 0).
- Settings writes are atomic (write to a temp file, then rename) and always backed up first.
- Conventional commits, changesets, a semver-checked public API.

---

## 8. Open questions

1. **Name**: resolved 2026-11-19. npm refused the unscoped `cclens` as too similar to `cc-lens`, so the package is `@abdofawzi5/cclens`; the command, data folder and plugin are still `cclens`.
2. **skills.sh key**: request one from skills-api@vercel.com, or ship that engine disabled until the user adds a key?
3. **Dashboard**: resolved 2026-11-19. 0.1.0 shipped CLI-only; the dashboard is now optional Phase 12, after `cclens report` (Phase 7).
4. **Windows support** in v1, or macOS/Linux only?

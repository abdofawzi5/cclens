# @abdofawzi5/cclens

## 1.0.1

### Patch Changes

- 09a0661: Search results now link to their GitHub repo when a registry gives git-style repository URLs (`git+https://…`, `git+ssh://…`, `git://…`, `git@github.com:…`), as npm does, so stars are looked up and duplicates merge.

## 1.0.0

### Major Changes

- First stable release: cclens 1.0.0. The CLI commands, their flags and the `--json` output are now considered stable and follow semver.

### Minor Changes

- 7b39e84: New `cclens advise` (alias `optimize`): runs every analysis in one pass (review rules, context overhead, unused plugins, recurring jobs and budget) and ranks what to change first. It adds findings for MCP servers whose tool lists cost tokens on every request, large CLAUDE.md and memory files, a heavy pre-prompt context, and a missing or passed budget; prints the `claude plugin disable` commands for unused plugins; and searches the skill registries for skills that might take over your scheduled or repeated tasks (`--no-search` to stay offline). The `/cclens` plugin command with no arguments now runs it.
- cbbc82b: New `cclens agents`: calls, runs, tokens and estimated cost for every subagent type you use (`--by session` shows where agent tokens went), and the installed agents you never call (`--unused`). Each run is priced per message by the model it actually ran on, using the LiteLLM price list ccusage uses (downloaded once a day, nothing sent); when a model has no price, the cost is the run's share of its session's cost and is marked `*`. `cclens review` gains two rules: `unused-agents` (agent descriptions cost tokens on every request) and `expensive-agents` (runs that used over 40% of their session's tokens).
- 26a19d9: New `cclens budget` and `cclens statusline`. Set daily or monthly limits with `cclens budget set --daily 50 --monthly 800`; when estimated spend passes one, Claude Code shows one line such as `cclens: today's estimated cost is $71 (daily budget $50)`, at most once a day per limit. `cclens budget show` prints spend against each limit. `cclens statusline` prints today's and this month's estimated spend for Claude Code's status line in about 50 ms (`--with-ccusage` adds ccusage's line). Spend is kept in `~/.cclens/cache/spend.json` and refreshed in the background. `cclens doctor` reports the budget, and `cclens init` suggests setting one.
- 010326a: New `cclens context`: what Claude Code sends before your first prompt, split into system prompt, tool definitions, deferred tool names per MCP server, skill listing, agent listing and CLAUDE.md/memory files. The total comes from the first reply's usage; the parts are estimated. `cclens skills --unused --fix` prints the `claude plugin disable` commands for unused plugins (it never runs them). `cclens review --compare` shows this window against the previous one. The unused-skills finding now uses the real size of Claude Code's skill listing from your latest transcript, which is much smaller than the old estimate because Claude Code drops descriptions when the list is long.
- 5778de6: New `cclens jobs`: scheduled tasks (grouped by the task's name) and sessions you repeat by hand (same title, three or more runs) shown as jobs, with runs, cost per run, how often they run and the expected monthly cost. Jobs that look stopped and one-off runs are not projected forward. `cclens jobs --job <name>` lists one job's runs. `cclens review` gains a `recurring-cost` rule that points at the costliest jobs and how to make each run cheaper.
- 1d984e9: Sessions are shown by name instead of only by id: `Title (abcd1234)` in `cclens tokens session` and in every `cclens review` finding. The name is the title Claude Code gave the session, or the start of its first prompt. `cclens review --session` now also accepts part of a title and lists the choices when several sessions match. Scheduled sessions (no typed prompt) are now counted too. `--json` output gains `title`; titles are never sent by `review --ai`.
- e0175ca: New `cclens ui`: the usage report as a live page on `http://127.0.0.1:4477` (local only). Switch between 7, 14, 30 and 90 days; the page reloads by itself when new usage comes in. `/api/report` serves the same JSON as `cclens --json report`. Options: `--port`, `--days`, `--no-open`.
- 2eb2be1: New `cclens report`: one usage report with totals, daily cost and tokens, cost by model, the costliest sessions (by name), unused skills by plugin and the review findings. It prints Markdown by default; `cclens report --open` writes a single HTML page with charts to `~/.cclens/reports/` and opens it in your browser. The page embeds Chart.js (MIT), works offline, makes no network requests and follows dark mode. `--json` gives the report model, and the plugin skill now charts that output when Claude has a chart tool.

## 0.1.0

### Minor Changes

- a109b66: First release. `cclens init` records every skill use through Claude Code hooks (or install the cclens Claude Code plugin and run `cclens init --plugin`). `skills`, `usage` and `tokens` show your skill inventory, skill use and token spend; `review` gives optimization advice from your own numbers, with an optional `--ai` second opinion; `search` finds skills across GitHub, SkillsMP and skills.sh, ranked by stars; `doctor` checks the setup.

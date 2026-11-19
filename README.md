# cclens

**Claude Code Lens**: see which skills you have and which you actually use, where your tokens go, how to use fewer, and find new skills across the main registries, ranked by GitHub stars.

> Status: Phases 1–5 done (install, capture, stats, review, search, packaging). See [docs/PLAN.md](docs/PLAN.md) and [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Install

```bash
npm install -g @abdofawzi5/cclens
cclens init --backfill
```

The npm package is scoped (`@abdofawzi5/cclens`); the command it installs is `cclens`.

`init` is safe to run again. It:

1. creates `~/.cclens/` (config and usage log);
2. backs up `~/.claude/settings.json` to `~/.cclens/backups/`;
3. registers two Claude Code hooks that record each skill use;
4. replaces the old manual `log-skill-usage.sh` hook if you had one and imports its log;
5. with `--backfill`, imports past skill uses from your Claude Code transcripts.

Preview first with `cclens init --dry-run`. Register hooks for one project only with `--scope project`. Needs Node.js 20 or newer.

### Or as a Claude Code plugin

The repo is also a Claude Code plugin marketplace. The plugin registers the same hooks, adds a `/cclens` command, and a skill that lets Claude answer "which skills do I never use?" or "what did I spend this week?" by running cclens:

```
/plugin marketplace add abdofawzi5/cclens
/plugin install cclens@cclens
```

The plugin runs the CLI, so install that too, then tell cclens the plugin owns the hooks:

```bash
npm install -g @abdofawzi5/cclens
cclens init --plugin
```

`--plugin` saves the absolute path of Node and cclens to `~/.cclens/hook-runner` (the desktop app doesn't load your shell's PATH) and keeps cclens hooks out of `settings.json`, so each skill use is recorded once. Use one setup or the other: if both are active, the plugin's hooks stand down and `cclens doctor` tells you how to keep one ([ADR 0006](docs/adr/0006-plugin-hook-runner.md)).

## Commands

| Command                 | What it does                                                                                                                                                                                                                                           |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `cclens skills`         | Installed skills with how often each was used. `--unused`, `--by-plugin`, `--plugin <name>`, `--scope personal\|project\|plugin`, `--since 30d`                                                                                                        |
| `cclens usage`          | Skill uses grouped `--by skill\|day\|project\|source`, with `--since`, `--until`, `--skill`, `--limit`                                                                                                                                                 |
| `cclens tokens [view]`  | Tokens and estimated cost: `daily` (default), `weekly`, `monthly`, `session`, `project`, `blocks` (5-hour windows). `--since`, `--until`, `--project`, `--limit`. Sessions are shown by name                                                           |
| `cclens review`         | Optimization advice from your own numbers. `--days 30`, `--session <id or title>` or `--last`, `--rule <id>`, `--list-rules`, `--ai`                                                                                                                   |
| `cclens report`         | Usage report: totals, daily cost and tokens, cost by model, costliest sessions, unused skills, findings. Markdown by default; `--open` writes a self-contained HTML page with charts and opens it; `--format json`, `--out <file>`, `--days`/`--since` |
| `cclens agents`         | Subagent use: calls, runs, tokens and estimated cost per agent type (`--by session` per session), and installed agents you never call (`--unused`). `--since 30d`                                                                                      |
| `cclens search <query>` | Search GitHub, SkillsMP and skills.sh at once, duplicates merged, ranked by stars. `--engine`, `--limit`, `--min-stars`, `--sort stars\|installs\|updated\|relevance`, `--refresh`                                                                     |
| `cclens engines`        | List search engines; `enable`, `disable`, `add <file.json>`, `remove`, `test [id]`                                                                                                                                                                     |
| `cclens init`           | Set up or repair cclens. `--plugin` when the Claude Code plugin records skill uses                                                                                                                                                                     |
| `cclens doctor`         | Check the installation and say how to fix problems                                                                                                                                                                                                     |
| `cclens uninstall`      | Remove the hooks; recorded data stays in `~/.cclens`                                                                                                                                                                                                   |
| `cclens paths`          | Show where cclens and Claude Code keep data                                                                                                                                                                                                            |
| `cclens config show`    | Show the effective configuration                                                                                                                                                                                                                       |

Sessions are shown by name, `Title (abcd1234)`: the title Claude Code gave the session, or the start of its first prompt. `--json` includes `title` and where it came from. Session names stay on your machine; `review --ai` never sends them.

Every command accepts `--json`. Dates accept `YYYY-MM-DD`, `YYYYMMDD` or relative values like `7d`, `4w`, `3m`.

Skills are found in `~/.claude/skills` (personal), `.claude/skills` (project), Claude Code's plugin folder, and the Claude desktop app's plugin folder. Claude Code's built-in skills, which aren't stored on disk, aren't listed. Token numbers come from [ccusage](https://github.com/ryoppippi/ccusage); costs are estimates at API list prices, not what your plan bills.

## How recording works

- **Claude runs a skill** → the `PostToolUse` hook (matcher `Skill`) records it as `auto`.
- **You type `/skill-name`** → the `UserPromptSubmit` hook records it as `typed`. Claude Code's own commands (`/compact`, `/clear`…) are ignored.
- The hook takes about 100 ms, never prints anything, and always exits 0. Problems go to `~/.cclens/hook-errors.log`.
- Hooks call Node and cclens by absolute path, so they work in the Claude desktop app, which doesn't load your shell's PATH. If you move cclens or switch Node versions, run `cclens init` again; `cclens doctor` tells you when.

## Skill search

`cclens search seo audit` asks every enabled engine in parallel, merges results that point at the same skill, adds GitHub stars where an engine has none, and ranks results that mention more of your words first, then by stars. Results are marked when you already have a skill with the same name. One engine failing never stops the others.

| Engine   | Searches                             | Notes                                                           |
| -------- | ------------------------------------ | --------------------------------------------------------------- |
| github   | GitHub repositories (`claude skill`) | Uses `GITHUB_TOKEN` or your `gh` login for a higher rate limit  |
| skillsmp | SkillsMP marketplace                 | Official API                                                    |
| skillssh | skills.sh, with install counts       | Public but undocumented endpoint; marked unofficial, may change |

Add any registry with a JSON definition and `cclens engines add engine.json`:

```json
{
  "id": "my-registry",
  "type": "generic-http",
  "name": "My registry",
  "request": {
    "url": "https://registry.example.com/search?q={query}&limit={limit}",
    "headers": { "Authorization": "Bearer ${env:MY_REGISTRY_KEY}" }
  },
  "response": {
    "items": "data.results",
    "map": {
      "name": "title",
      "url": "link",
      "description": "summary",
      "repoUrl": "repo",
      "stars": "stars"
    }
  }
}
```

Keys are always `${env:NAME}` references and never stored in the file.

## Privacy

Everything stays on your machine. `cclens review --ai` is the one exception you opt into: it runs `claude -p` with your own Claude login and sends aggregate numbers only (token totals, session sizes, rule findings), never your prompts or transcripts. Tools and MCP servers are turned off for that call and spending is capped at $0.50. Skill search sends only your search text to the registries, and repository names to GitHub to look up stars. `cclens agents` downloads the public LiteLLM model price list (the one ccusage uses) once a day to price subagent messages; it sends nothing about you.

## Development

```bash
pnpm install
pnpm check        # typecheck, lint, format, tests
pnpm coverage
pnpm build && node dist/cli.js --help
pnpm verify:apis  # live check of every external API cclens uses
claude plugin validate .   # check the marketplace and plugin manifests
```

### Releasing

Releases use [changesets](https://github.com/changesets/changesets). Add one with `pnpm changeset` in each pull request that changes behaviour, then:

```bash
pnpm version-packages   # bump package.json, write CHANGELOG.md, sync plugin.json
npm publish --dry-run   # prepublishOnly runs pnpm check && pnpm build
pnpm release            # changeset publish
```

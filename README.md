# cclens

**Claude Code Lens**: see which skills you have and which you actually use, where your tokens go, how to use fewer, and find new skills across the main registries, ranked by GitHub stars.

> Status: Phases 1–2 done (install, capture, stats). Session review and skill search are next. See [docs/PLAN.md](docs/PLAN.md) and [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Install

```bash
npm install -g cclens
cclens init --backfill
```

`init` is safe to run again. It:

1. creates `~/.cclens/` (config and usage log);
2. backs up `~/.claude/settings.json` to `~/.cclens/backups/`;
3. registers two Claude Code hooks that record each skill use;
4. replaces the old manual `log-skill-usage.sh` hook if you had one and imports its log;
5. with `--backfill`, imports past skill uses from your Claude Code transcripts.

Preview first with `cclens init --dry-run`. Register hooks for one project only with `--scope project`.

## Commands

| Command                | What it does                                                                                                                                                     |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `cclens skills`        | Installed skills with how often each was used. `--unused`, `--by-plugin`, `--plugin <name>`, `--scope personal\|project\|plugin`, `--since 30d`                  |
| `cclens usage`         | Skill uses grouped `--by skill\|day\|project\|source`, with `--since`, `--until`, `--skill`, `--limit`                                                           |
| `cclens tokens [view]` | Tokens and estimated cost: `daily` (default), `weekly`, `monthly`, `session`, `project`, `blocks` (5-hour windows). `--since`, `--until`, `--project`, `--limit` |
| `cclens init`          | Set up or repair cclens                                                                                                                                          |
| `cclens doctor`        | Check the installation and say how to fix problems                                                                                                               |
| `cclens uninstall`     | Remove the hooks; recorded data stays in `~/.cclens`                                                                                                             |
| `cclens paths`         | Show where cclens and Claude Code keep data                                                                                                                      |
| `cclens config show`   | Show the effective configuration                                                                                                                                 |

Every command accepts `--json`. Dates accept `YYYY-MM-DD`, `YYYYMMDD` or relative values like `7d`, `4w`, `3m`.

Skills are found in `~/.claude/skills` (personal), `.claude/skills` (project), Claude Code's plugin folder, and the Claude desktop app's plugin folder. Claude Code's built-in skills, which aren't stored on disk, aren't listed. Token numbers come from [ccusage](https://github.com/ryoppippi/ccusage); costs are estimates at API list prices, not what your plan bills.

## How recording works

- **Claude runs a skill** → the `PostToolUse` hook (matcher `Skill`) records it as `auto`.
- **You type `/skill-name`** → the `UserPromptSubmit` hook records it as `typed`. Claude Code's own commands (`/compact`, `/clear`…) are ignored.
- The hook takes about 100 ms, never prints anything, and always exits 0. Problems go to `~/.cclens/hook-errors.log`.
- Hooks call Node and cclens by absolute path, so they work in the Claude desktop app, which doesn't load your shell's PATH. If you move cclens or switch Node versions, run `cclens init` again; `cclens doctor` tells you when.

## Privacy

Everything stays on your machine. Skill search (coming next) sends only your search text to the registries.

## Development

```bash
pnpm install
pnpm check        # typecheck, lint, format, tests
pnpm coverage
pnpm build && node dist/cli.js --help
pnpm verify:apis  # live check of every external API cclens uses
```

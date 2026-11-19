---
name: cclens
description: Answer questions about the user's Claude Code skills, skill usage, token spend and cost, and how to use fewer tokens, which subagents they use and what those cost, what their scheduled tasks cost, chart or report their usage, or find new skills, by running the cclens CLI. Use when the user asks which skills they have or use, which skills are unused, how many tokens or dollars Claude Code used (per day, week, month, session, project or 5-hour block), how to cut token use, or to search registries for a skill.
---

# cclens

cclens reads Claude Code's own data on this machine and answers from it. Run it with the Bash tool and add `--json` when you need to read the numbers; leave it off when the user wants the table as is.

## Finding the CLI

1. Run `cclens --version`. If that works, use `cclens`.
2. If the command is not found, use the command line `cclens init` saved (it works without PATH):
   `eval "$(cat "${CCLENS_HOME:-$HOME/.cclens}/hook-runner") --version"` and then the same prefix for every command below.
3. If neither works, cclens is not installed. Tell the user to run `npm i -g @abdofawzi5/cclens && cclens init --plugin`, and stop.

## Pick the command

| The user asks                                                          | Run                                                                                      |
| ---------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Which skills are installed, by plugin, how often used                  | `cclens skills` (`--by-plugin`, `--plugin <name>`, `--since 30d`)                        |
| Which skills they never use                                            | `cclens skills --unused --since 30d`                                                     |
| Skill use over time or per project                                     | `cclens usage --by skill\|day\|project\|source --since 7d`                               |
| Tokens and estimated cost                                              | `cclens tokens daily\|weekly\|monthly\|session\|project\|blocks`                         |
| Everything at once: what to change, plugins to turn off, skills to try | `cclens advise` (`--days 30`, `--no-search` offline)                                     |
| How to use fewer tokens                                                | `cclens review --days 30` (`--last`, or `--session <id or title>`)                       |
| A skill for some task                                                  | `cclens search <words>` (`--min-stars 50`, `--sort stars\|installs`)                     |
| Subagents: which run, what they cost, which are unused                 | `cclens agents` (`--by session`, `--unused`, `--since 30d`)                              |
| Scheduled or repeated tasks and what they cost a month                 | `cclens jobs` (`--job <name>` for one job's runs, `--since 30d`)                         |
| A live dashboard in the browser                                        | `cclens ui` (keeps running until stopped; tell the user to run it in their own terminal) |
| What fills the context before the first prompt                         | `cclens context` (`--last`, `--since 14d`)                                               |
| Turn off unused plugins                                                | `cclens skills --unused --fix` (prints commands; the user runs them)                     |
| Did a change help?                                                     | `cclens review --compare`                                                                |
| Spend limits and warnings                                              | `cclens budget` (`set --daily <usd> --monthly <usd>`, `show`, `clear`)                   |
| A status line with today's spend                                       | `cclens statusline` in `statusLine` of `~/.claude/settings.json`                         |
| A report, a chart or a usage overview                                  | see "Charts and reports" below                                                           |
| Whether recording works                                                | `cclens doctor`                                                                          |

Dates take `YYYY-MM-DD` or relative values like `7d`, `4w`, `3m`.

## Charts and reports

- If you have a chart or visual tool in this conversation (for example one that renders charts or HTML inline), run the matching command with `--json` (`cclens report --json`, `cclens tokens daily --json`, `cclens usage --by skill --json`) and chart those numbers yourself. Label costs as estimates.
- Otherwise run `cclens report --open`. It writes one HTML page with charts to `~/.cclens/reports/` and opens it in the browser; the page works offline. Tell the user the path it printed.
- For a text summary in the chat, `cclens report` prints Markdown.

## Rules

- Report numbers exactly as cclens prints them. Costs are estimates at API list prices, not the user's bill; say so when you quote a cost. In `cclens agents`, a cost marked `*` is the run's share of its session's cost, because its model had no price.
- `cclens review --ai` and `cclens advise --ai` call Claude with a spending cap; run it only when the user asks for an AI review.
- `cclens search` and the skills `cclens advise` suggests are suggestions. Show the install hint; never install a skill without the user saying so.
- Do not run `cclens init`, `cclens uninstall` or `cclens engines enable|disable|add|remove` unless the user asks; they change settings.

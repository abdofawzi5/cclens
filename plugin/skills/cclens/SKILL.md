---
name: cclens
description: Answer questions about the user's Claude Code skills, skill usage, token spend and cost, and how to use fewer tokens, or find new skills, by running the cclens CLI. Use when the user asks which skills they have or use, which skills are unused, how many tokens or dollars Claude Code used (per day, week, month, session, project or 5-hour block), how to cut token use, or to search registries for a skill.
---

# cclens

cclens reads Claude Code's own data on this machine and answers from it. Run it with the Bash tool and add `--json` when you need to read the numbers; leave it off when the user wants the table as is.

## Finding the CLI

1. Run `cclens --version`. If that works, use `cclens`.
2. If the command is not found, use the command line `cclens init` saved (it works without PATH):
   `eval "$(cat "${CCLENS_HOME:-$HOME/.cclens}/hook-runner") --version"` and then the same prefix for every command below.
3. If neither works, cclens is not installed. Tell the user to run `npm i -g @abdofawzi5/cclens && cclens init --plugin`, and stop.

## Pick the command

| The user asks                                         | Run                                                                  |
| ----------------------------------------------------- | -------------------------------------------------------------------- |
| Which skills are installed, by plugin, how often used | `cclens skills` (`--by-plugin`, `--plugin <name>`, `--since 30d`)    |
| Which skills they never use                           | `cclens skills --unused --since 30d`                                 |
| Skill use over time or per project                    | `cclens usage --by skill\|day\|project\|source --since 7d`           |
| Tokens and estimated cost                             | `cclens tokens daily\|weekly\|monthly\|session\|project\|blocks`     |
| How to use fewer tokens                               | `cclens review --days 30` (`--last`, or `--session <id or title>`)   |
| A skill for some task                                 | `cclens search <words>` (`--min-stars 50`, `--sort stars\|installs`) |
| Whether recording works                               | `cclens doctor`                                                      |

Dates take `YYYY-MM-DD` or relative values like `7d`, `4w`, `3m`.

## Rules

- Report numbers exactly as cclens prints them. Costs are estimates at API list prices, not the user's bill; say so when you quote a cost.
- `cclens review --ai` calls Claude with a spending cap; run it only when the user asks for an AI review.
- `cclens search` results are suggestions. Show the install hint; never install a skill without the user saying so.
- Do not run `cclens init`, `cclens uninstall` or `cclens engines enable|disable|add|remove` unless the user asks; they change settings.

---
description: Show skill usage, token stats, optimization advice, reports with charts or skill search from cclens
argument-hint: '[advise | skills | usage | tokens [view] | review | report | search <words> | doctor] [options]'
allowed-tools: Bash(cclens:*), Bash(eval:*), Bash(cat:*)
---

Run the cclens CLI with these arguments: `$ARGUMENTS`

- With no arguments, run `cclens advise --days 30`, then give a short summary: the top savings, the plugins to turn off (show the commands; do not run them) and any suggested skills.
- Otherwise run `cclens $ARGUMENTS` and summarize the output in a few lines. Keep the numbers exactly as printed.
- If `cclens` is not found, follow the "Finding the CLI" steps in the cclens skill.

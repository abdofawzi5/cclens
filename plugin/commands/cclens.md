---
description: Show skill usage, token stats, optimization advice, reports with charts or skill search from cclens
argument-hint: '[skills | usage | tokens [view] | review | report | search <words> | doctor] [options]'
allowed-tools: Bash(cclens:*), Bash(eval:*), Bash(cat:*)
---

Run the cclens CLI with these arguments: `$ARGUMENTS`

- With no arguments, run `cclens review --days 30` and `cclens skills --unused --since 30d`, then give a short summary: the top savings and the unused skills.
- Otherwise run `cclens $ARGUMENTS` and summarize the output in a few lines. Keep the numbers exactly as printed.
- If `cclens` is not found, follow the "Finding the CLI" steps in the cclens skill.

---
'@abdofawzi5/cclens': minor
---

New `cclens budget` and `cclens statusline`. Set daily or monthly limits with `cclens budget set --daily 50 --monthly 800`; when estimated spend passes one, Claude Code shows one line such as `cclens: today's estimated cost is $71 (daily budget $50)`, at most once a day per limit. `cclens budget show` prints spend against each limit. `cclens statusline` prints today's and this month's estimated spend for Claude Code's status line in about 50 ms (`--with-ccusage` adds ccusage's line). Spend is kept in `~/.cclens/cache/spend.json` and refreshed in the background. `cclens doctor` reports the budget, and `cclens init` suggests setting one.

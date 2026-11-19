---
'@abdofawzi5/cclens': minor
---

New `cclens context`: what Claude Code sends before your first prompt, split into system prompt, tool definitions, deferred tool names per MCP server, skill listing, agent listing and CLAUDE.md/memory files. The total comes from the first reply's usage; the parts are estimated. `cclens skills --unused --fix` prints the `claude plugin disable` commands for unused plugins (it never runs them). `cclens review --compare` shows this window against the previous one. The unused-skills finding now uses the real size of Claude Code's skill listing from your latest transcript, which is much smaller than the old estimate because Claude Code drops descriptions when the list is long.

---
'@abdofawzi5/cclens': minor
---

New `cclens advise` (alias `optimize`): runs every analysis in one pass (review rules, context overhead, unused plugins, recurring jobs and budget) and ranks what to change first. It adds findings for MCP servers whose tool lists cost tokens on every request, large CLAUDE.md and memory files, a heavy pre-prompt context, and a missing or passed budget; prints the `claude plugin disable` commands for unused plugins; and searches the skill registries for skills that might take over your scheduled or repeated tasks (`--no-search` to stay offline). The `/cclens` plugin command with no arguments now runs it.

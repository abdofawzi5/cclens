---
'@abdofawzi5/cclens': minor
---

`cclens advise` (alias `optimize`) now always ends with an action plan: up to five structural changes ranked by estimated dollars saved a month, each with the numbers behind it and the exact files to change. It suggests a Sonnet helper subagent for recurring jobs that spend most of their Opus calls on shell commands, a helper that looks at images instead of the main session, `grep`/`tail` for big files a job reads whole on most runs, and a lean per-folder `.claude/settings.json` that turns off plugins and MCP servers never used in that folder. To do this, cclens now reads more from each transcript: model calls, context size per call, tool calls, image reads, file read sizes, MCP servers used and the session's folder. `--json` gains `plan`.

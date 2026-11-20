---
'@abdofawzi5/cclens': minor
---

Add `--claude-dir` and `--cclens-home` to run cclens against one environment: only that Claude Code config dir is read (no desktop-app plugins), ccusage gets the same dir, and `init` writes the flags into the hooks so skill uses are recorded in that environment's own data dir.

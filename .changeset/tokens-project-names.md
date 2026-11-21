---
'@abdofawzi5/cclens': patch
---

`cclens tokens --project` now works: it accepts a folder path (`.`, `~/Workspace/site`), the folder name (`site`) or the name shown in `tokens project`, and no longer fails on full project names that start with `-`. It applies to the daily, session and project views; other views say so instead of failing inside ccusage.

---
'@abdofawzi5/cclens': minor
---

New `cclens ui`: the usage report as a live page on `http://127.0.0.1:4477` (local only). Switch between 7, 14, 30 and 90 days; the page reloads by itself when new usage comes in. `/api/report` serves the same JSON as `cclens --json report`. Options: `--port`, `--days`, `--no-open`.

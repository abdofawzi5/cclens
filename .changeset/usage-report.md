---
'@abdofawzi5/cclens': minor
---

New `cclens report`: one usage report with totals, daily cost and tokens, cost by model, the costliest sessions (by name), unused skills by plugin and the review findings. It prints Markdown by default; `cclens report --open` writes a single HTML page with charts to `~/.cclens/reports/` and opens it in your browser. The page embeds Chart.js (MIT), works offline, makes no network requests and follows dark mode. `--json` gives the report model, and the plugin skill now charts that output when Claude has a chart tool.

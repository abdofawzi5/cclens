---
'@abdofawzi5/cclens': patch
---

`cclens search` no longer drops SkillsMP when `--limit` is above 50: it now asks SkillsMP for at most 50 results, the most its API accepts. The "Showing N of M" line now counts only results that pass the filters and says how many `--min-stars` or archived repositories hid. `--json` gains `filteredOut`.

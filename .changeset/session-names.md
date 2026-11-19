---
'@abdofawzi5/cclens': minor
---

Sessions are shown by name instead of only by id: `Title (abcd1234)` in `cclens tokens session` and in every `cclens review` finding. The name is the title Claude Code gave the session, or the start of its first prompt. `cclens review --session` now also accepts part of a title and lists the choices when several sessions match. Scheduled sessions (no typed prompt) are now counted too. `--json` output gains `title`; titles are never sent by `review --ai`.

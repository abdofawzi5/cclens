# Fixtures

Real responses recorded on 2026-11-19, trimmed and anonymised. Contract tests use them so adapters are tested against the actual shapes without network access.

- `ccusage/`: `ccusage claude daily|session|blocks --json --offline` (v20.0.51). Session ids and project paths replaced.
- `engines/`: SkillsMP search, skills.sh public search, GitHub repository search.

Refresh with `pnpm verify:apis` first; if a shape changed, re-record and update the adapter's zod schema.

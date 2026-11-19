# Fixtures

Real responses recorded on 2026-11-19, trimmed and anonymised. Contract tests use them so adapters are tested against the actual shapes without network access.

- `ccusage/`: `ccusage claude daily|session|blocks --json --offline` (v20.0.51). Session ids and project paths replaced.
- `engines/`: SkillsMP search, skills.sh public search, GitHub repository search.
- `claude/`: `claude -p --output-format json` result envelopes. `not-logged-in.json` was recorded (ids replaced); `success.json` follows the same envelope with a made-up review, because the recording machine was not signed in to the Claude Code CLI.

Refresh with `pnpm verify:apis` first; if a shape changed, re-record and update the adapter's zod schema.

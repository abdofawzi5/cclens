# ADR 0004: Explicit `cclens init`; no npm postinstall

- Status: accepted
- Date: 2026-11-19

## Context

Skill-usage capture needs Claude Code hooks in `settings.json`. npm `postinstall` could add them automatically, but pnpm (v10+) blocks dependency build scripts by default, CI and global installs often skip them, and silently editing a user's editor config is poor practice.

## Decision

- `npm i -g cclens` installs only the binary.
- `cclens init` is explicit and safe to re-run: create `~/.cclens/`, back up `settings.json`, merge hooks atomically, migrate the legacy `~/.claude/skill-usage.log` (after confirmation), optionally backfill from transcripts, then run `doctor`.
- `cclens uninstall` removes exactly the hooks cclens added (matched by command prefix) and can restore the backup.
- Alternative path: the repo is also a Claude Code plugin marketplace; installing the plugin registers the same hooks through `hooks/hooks.json`.
- Hook commands always exit 0, finish within 150 ms, and log failures to `~/.cclens/hook-errors.log`.

## Consequences

One extra command after install, documented in the README and printed after `npm i -g` via the `bin` help text.

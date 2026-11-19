# ADR 0002: Token usage comes from the ccusage CLI (JSON), not its library

- Status: accepted
- Date: 2026-11-19

## Context

The plan assumed `ccusage/data-loader` as a library import. Checked against the installed ccusage **20.0.51**: the package no longer has `exports`, `main` or types. It ships only `src/cli.js` (a bundled CLI). The library API documented for older versions is gone.

The CLI does provide stable JSON:

- `ccusage claude daily|weekly|monthly --json [--since YYYYMMDD] [--offline]` → `{ daily|weekly|monthly: [...], totals }`
- `ccusage claude session --json` → `{ sessions: [{ sessionId, projectPath, firstActivity, lastActivity, inputTokens, outputTokens, cacheCreationTokens, cacheReadTokens, totalCost, modelsUsed, modelBreakdowns }], totals }`
- `ccusage claude blocks --json` → `{ blocks: [{ startTime, endTime, isActive, tokenCounts, costUSD, burnRate, projection }] }`

## Decision

`CcusageTokenProvider` implements `TokenUsageProvider` by running the CLI bundled as our dependency (`node <resolved ccusage>/src/cli.js claude … --json --offline`) through the `ProcessRunner` port, and validating the output with zod.

- The `claude` subcommand keeps the output limited to Claude Code; ccusage now covers other agents too.
- `--offline` uses ccusage's bundled price table, so no network call is made by default.
- Recorded fixtures live in `test/fixtures/ccusage/` (anonymised) for contract tests.

## Consequences

- About 100–300 ms of process start-up per call; acceptable for a CLI and never on the hook path.
- If ccusage changes its JSON, zod fails loudly with a clear `IntegrationError` instead of wrong numbers. The dependency is pinned to the minor version and Renovate PRs re-run the contract tests.

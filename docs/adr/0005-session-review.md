# ADR 0005: Session review: offline rules first, `claude -p` as an opt-in second opinion

- Status: accepted
- Date: 2026-11-19

## Context

`cclens review` should tell people how to use fewer tokens. Advice is only useful when it is grounded in their own numbers, and a review must not send private data anywhere or spend tokens unless asked.

Data available locally, verified on a real machine:

- ccusage: tokens and estimated cost per day and session, including a per-model split (`modelBreakdowns`).
- Claude Code transcripts: user prompts (`origin.kind: "human"`) and compactions (`type: "system", subtype: "compact_boundary"`, with `compactMetadata.trigger` and `preTokens`).
- Installed skills with their descriptions, and recorded skill uses.

Not available: the plan's usage limits, and the size of MCP tool definitions in context.

## Decision

- Rules are pure `OptimizationRule` strategies in `src/core/rules`, each with its own thresholds and fixture tests. The `ReviewService` builds one `ReviewContext`, runs the rules that apply to the scope (whole window or one session), and sorts findings by severity, then by estimated savings.
- A source that fails (for example ccusage) or a rule that throws makes the report partial, with a note, instead of failing the review.
- First rule set: `unused-skills`, `long-sessions`, `frequent-compaction`, `cache-churn`, `model-mix`, `usage-spikes`.
- `near-plan-limit` and `heavy-mcp-overhead` from the original plan are left out until cclens can read plan limits and MCP context size; a rule without real data would only guess.
- `--ai` runs headless Claude Code with the user's own login: `claude -p --output-format json --no-session-persistence --tools "" --strict-mcp-config --disable-slash-commands --max-budget-usd 0.5 --model sonnet`. The prompt holds aggregate numbers and the rule titles only: no prompts, no transcript text, and project names cut to their last segment. The reply must be a JSON list, validated with zod.

## Consequences

- Reviews are fast (well under a second on hundreds of MB of transcripts) and work offline.
- Skill-listing cost is an estimate (about 4 characters per token) and an upper bound, because Claude Code shortens a long skill list.
- The AI path depends on the user being signed in to the Claude Code CLI; when not, the review still prints the rule findings and says how to sign in.

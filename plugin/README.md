# cclens Claude Code plugin

Records each skill use for [cclens](../README.md) and teaches Claude to answer questions with the cclens CLI.

- **Hooks**: `PostToolUse` (matcher `Skill`) and `UserPromptSubmit`, the same two hooks `cclens init` adds to `settings.json`.
- **`/cclens [args]`**: runs cclens; with no arguments it summarizes savings and unused skills.
- **`cclens` skill**: lets Claude pick the right cclens command when you ask about skills, tokens or cost.

Install it from this repo's marketplace:

```
/plugin install cclens --marketplace abdofawzi5/cclens
```

On older Claude Code versions use `/plugin marketplace add abdofawzi5/cclens`, then `/plugin install cclens@cclens`.

The plugin needs the CLI:

```bash
npm install -g @abdofawzi5/cclens
cclens init --plugin
```

`--plugin` saves the absolute path of Node and cclens to `~/.cclens/hook-runner`, so the hooks work in the Claude desktop app, which doesn't load your shell's PATH. It also removes any cclens hooks from `settings.json`, so each skill use is recorded once. If both are present anyway, the plugin's hooks stand down and `cclens doctor` warns. See [ADR 0006](../docs/adr/0006-plugin-hook-runner.md).

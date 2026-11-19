# ADR 0006: How the plugin's hooks find the cclens CLI

- Status: accepted
- Date: 2026-11-19

## Context

The repo is also a Claude Code plugin marketplace (`.claude-plugin/marketplace.json` → `plugin/`). The plugin's `hooks/hooks.json` registers the same two hooks as `cclens init` (`PostToolUse` matcher `Skill`, and `UserPromptSubmit`). Three problems follow:

1. **PATH.** Hook commands run in a shell that GUI apps such as the Claude desktop app start without your shell profile, so `cclens` and often `node` are not on PATH. `cclens init` already avoids this by writing absolute paths into `settings.json` (`"/opt/homebrew/bin/node" "/…/cli.js"`), but `hooks.json` is static and ships inside the plugin.
2. **No bundled CLI.** The plugin is copied from git, where `dist/` is not committed. It cannot run cclens by itself.
3. **Double counting.** A user who ran `cclens init` and later installs the plugin would have both sets of hooks firing, recording every skill use twice.

`npx -y cclens hook` (the idea in PLAN.md) was rejected: it needs `npx` on PATH (problem 1), can hit the network on every prompt, takes far longer than the 150 ms hook budget, and would run whatever version is newest on npm.

## Decision

- **A runner file.** `cclens init` writes the exact command it puts in `settings.json` (absolute Node + absolute `cli.js`) to `~/.cclens/hook-runner` (`$CCLENS_HOME/hook-runner`). It refreshes the file on every run, so re-running `init` after moving cclens or upgrading Node fixes both paths.
- **A POSIX shell script.** `hooks.json` runs `sh "${CLAUDE_PLUGIN_ROOT}/hooks/record-skill-use.sh"`. The script:
  1. exits at once when a `settings.json` (user, or the current project's) already contains the `CCLENS_HOOK=1` marker of an `init` hook, so a use is never counted twice;
  2. otherwise runs the command in `hook-runner` with `hook` appended, passing stdin through;
  3. otherwise runs `cclens hook` if `cclens` is on PATH;
  4. otherwise appends a hint (`npm i -g @abdofawzi5/cclens && cclens init --plugin`) to `~/.cclens/hook-errors.log`.

  It prints nothing and always exits 0. `sh` and `grep` are in `/bin` and `/usr/bin` on macOS and Linux, and Claude Code on Windows runs hooks through Git Bash.

- **One owner of the hooks.** `cclens init --plugin` registers no hooks in `settings.json`, removes any cclens hooks already there, and writes the runner file. `cclens init` without the flag keeps the current behaviour. `cclens doctor`:
  - accepts either source for the "hooks" check (it reads `enabledPlugins` for a `cclens@…` key);
  - adds a `hook-owner` check that warns when both sources are active;
  - checks the runner file's paths when only the plugin records uses, and fails with the fix when the file is missing.

## Consequences

- Plugin users still install the CLI from npm and run `cclens init --plugin` once. The plugin README, the skill and the `/cclens` command say so.
- The standing-down check costs one `grep` per hook call; the runner path adds no work beyond what the `settings.json` hook already does.
- `hook-runner` is evaluated by `sh`. It is written only by cclens, in the user's own data folder, with mode 0600, so it carries the same trust as `settings.json`.
- `plugin/.claude-plugin/plugin.json` carries a version that must match `package.json`. `pnpm version-packages` runs `changeset version` and then copies the version across, and a unit test fails if they drift.

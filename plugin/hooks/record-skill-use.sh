#!/bin/sh
# cclens plugin hook: hands the Claude Code hook payload (stdin) to the cclens CLI.
# It always exits 0, so Claude Code is never blocked. Its only output is the one JSON line
# cclens prints when a budget limit is passed (UserPromptSubmit), which Claude Code shows.
# Why it works this way: docs/adr/0006-plugin-hook-runner.md

cclens_home="${CCLENS_HOME:-$HOME/.cclens}"
claude_home="${CLAUDE_CONFIG_DIR:-$HOME/.claude}"

# `cclens init` hooks in settings.json already record this event. Stand down so it counts once.
for settings in "$claude_home/settings.json" "${CLAUDE_PROJECT_DIR:-.}/.claude/settings.json"; do
  if [ -f "$settings" ] && grep -q 'CCLENS_HOOK=1' "$settings" 2>/dev/null; then
    exit 0
  fi
done

# 1. The command `cclens init` saved: absolute node + cli.js, so no PATH is needed.
runner_file="$cclens_home/hook-runner"
if [ -s "$runner_file" ]; then
  runner=$(cat "$runner_file")
  eval "$runner hook" 2>/dev/null
  exit 0
fi

# 2. A cclens on PATH (works in terminals; GUI apps often have a shorter PATH).
if command -v cclens >/dev/null 2>&1; then
  cclens hook 2>/dev/null
  exit 0
fi

# 3. Nothing to run: leave a note for `cclens doctor` and the user.
mkdir -p "$cclens_home" 2>/dev/null &&
  printf '%s cclens plugin: cclens CLI not found. Run: npm i -g @abdofawzi5/cclens && cclens init --plugin\n' \
    "$(date -u +%Y-%m-%dT%H:%M:%SZ)" >>"$cclens_home/hook-errors.log" 2>/dev/null
exit 0

import type { HookSpec } from '../ports/claude-settings.js';

/** Marker present in every hook command cclens writes, so it can find and remove them. */
export const CCLENS_HOOK_MARKER = 'CCLENS_HOOK=1';

export function isCclensHookCommand(command: string): boolean {
  return command.includes(CCLENS_HOOK_MARKER);
}

/** Name of the cclens Claude Code plugin (see `plugin/.claude-plugin/plugin.json`). */
export const CCLENS_PLUGIN_NAME = 'cclens';

/** True for an `enabledPlugins` key such as `cclens@cclens` or `cclens@my-marketplace`. */
export function isCclensPluginKey(key: string): boolean {
  return key === CCLENS_PLUGIN_NAME || key.startsWith(`${CCLENS_PLUGIN_NAME}@`);
}

/** Hooks from the manual pre-cclens setup (`~/.claude/hooks/log-skill-usage.sh`). */
export function isLegacyHookCommand(command: string): boolean {
  return command.includes('log-skill-usage.sh');
}

/**
 * The hooks cclens needs. `runner` is the shell command that starts the cclens CLI,
 * e.g. `"/usr/local/bin/node" "/path/to/cli.js"`.
 */
export function cclensHookSpecs(runner: string): readonly HookSpec[] {
  const command = `${CCLENS_HOOK_MARKER} ${runner} hook`;
  return [
    { event: 'PostToolUse', matcher: 'Skill', command },
    { event: 'UserPromptSubmit', command },
  ];
}

/** `enabledPlugins` keys (`name@marketplace`) set to true and to false in one settings file. */
export interface PluginSwitches {
  readonly enabled: readonly string[];
  readonly disabled: readonly string[];
}

const pluginName = (key: string): string => key.split('@')[0] ?? key;

/**
 * Names of plugins turned off in Claude Code settings, so cclens does not count their
 * skills and agents as installed. Project settings override user settings for the same
 * key. Plugins are matched by name, as elsewhere in cclens; a name stays counted when any
 * of its keys is still enabled.
 */
export function disabledPluginNames(
  user: PluginSwitches,
  project: PluginSwitches,
): ReadonlySet<string> {
  const state = new Map<string, boolean>();
  for (const scope of [user, project]) {
    for (const key of scope.enabled) state.set(key, true);
    for (const key of scope.disabled) state.set(key, false);
  }
  const on = new Set<string>();
  const off = new Set<string>();
  for (const [key, enabled] of state) (enabled ? on : off).add(pluginName(key));
  return new Set([...off].filter((name) => !on.has(name)));
}

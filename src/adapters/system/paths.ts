import { homedir } from 'node:os';
import { join } from 'node:path';
import type { Paths } from '../../core/ports/infrastructure.js';

/** Resolves every location cclens reads or writes. Honours CCLENS_HOME and CLAUDE_CONFIG_DIR. */
export function resolvePaths(
  env: NodeJS.ProcessEnv = process.env,
  home: string = homedir(),
): Paths {
  const cclensHome = env['CCLENS_HOME'] ?? join(home, '.cclens');
  const claudeHome = env['CLAUDE_CONFIG_DIR'] ?? join(home, '.claude');
  return {
    home: cclensHome,
    configFile: join(cclensHome, 'config.json'),
    eventsFile: join(cclensHome, 'events.jsonl'),
    cacheDir: join(cclensHome, 'cache'),
    backupsDir: join(cclensHome, 'backups'),
    hookErrorLog: join(cclensHome, 'hook-errors.log'),
    hookRunnerFile: join(cclensHome, 'hook-runner'),
    claudeHome,
    claudeProjectsDir: join(claudeHome, 'projects'),
    claudeSkillsDir: join(claudeHome, 'skills'),
    pluginRoots: pluginRoots(claudeHome, home, env),
    legacyUsageLog: join(claudeHome, 'skill-usage.log'),
  };
}

/** Claude Code's plugin folder plus the Claude desktop app's, when present on this OS. */
function pluginRoots(claudeHome: string, home: string, env: NodeJS.ProcessEnv): string[] {
  const roots = [join(claudeHome, 'plugins')];
  const desktop =
    process.platform === 'darwin'
      ? join(home, 'Library', 'Application Support', 'Claude')
      : process.platform === 'win32'
        ? join(env['APPDATA'] ?? join(home, 'AppData', 'Roaming'), 'Claude')
        : join(env['XDG_CONFIG_HOME'] ?? join(home, '.config'), 'Claude');
  roots.push(join(desktop, 'local-agent-mode-sessions'));
  return roots;
}

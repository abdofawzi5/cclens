import { homedir } from 'node:os';
import { join } from 'node:path';
import type { Paths } from '../../core/ports/infrastructure.js';

/**
 * Resolves every location cclens reads or writes. Honours CCLENS_HOME and the Claude dir:
 * CCLENS_CLAUDE_DIR (set by `--claude-dir`) first, then CLAUDE_CONFIG_DIR. Only with
 * CCLENS_CLAUDE_DIR is the environment isolated: the desktop app's plugins are left out.
 */
export function resolvePaths(
  env: NodeJS.ProcessEnv = process.env,
  home: string = homedir(),
): Paths {
  const cclensHome = env['CCLENS_HOME'] ?? join(home, '.cclens');
  const isolated = env['CCLENS_CLAUDE_DIR'] || undefined;
  const claudeHome = isolated ?? env['CLAUDE_CONFIG_DIR'] ?? join(home, '.claude');
  return {
    home: cclensHome,
    configFile: join(cclensHome, 'config.json'),
    eventsFile: join(cclensHome, 'events.jsonl'),
    cacheDir: join(cclensHome, 'cache'),
    backupsDir: join(cclensHome, 'backups'),
    hookErrorLog: join(cclensHome, 'hook-errors.log'),
    hookRunnerFile: join(cclensHome, 'hook-runner'),
    spendFile: join(cclensHome, 'cache', 'spend.json'),
    claudeHome,
    claudeProjectsDir: join(claudeHome, 'projects'),
    claudeSkillsDir: join(claudeHome, 'skills'),
    pluginRoots: isolated ? [join(claudeHome, 'plugins')] : pluginRoots(claudeHome, home, env),
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

/**
 * The flags a hook command must carry to record into this same environment, e.g.
 * ` --claude-dir "/x/.claude-work" --cclens-home "/x/.cclens-work"`. Empty by default,
 * so hooks of an ordinary setup are unchanged.
 */
export function hookDirArgs(env: NodeJS.ProcessEnv = process.env): string {
  const parts: string[] = [];
  const claudeDir = env['CCLENS_CLAUDE_DIR'];
  const cclensHome = env['CCLENS_HOME'];
  if (claudeDir) parts.push(`--claude-dir "${claudeDir}"`);
  if (cclensHome) parts.push(`--cclens-home "${cclensHome}"`);
  return parts.length === 0 ? '' : ` ${parts.join(' ')}`;
}

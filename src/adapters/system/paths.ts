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
    claudeHome,
    claudeProjectsDir: join(claudeHome, 'projects'),
    claudeSkillsDir: join(claudeHome, 'skills'),
    legacyUsageLog: join(claudeHome, 'skill-usage.log'),
  };
}

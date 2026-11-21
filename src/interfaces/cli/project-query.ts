import { isAbsolute, resolve } from 'node:path';
import { encodeProjectPath } from '../../core/domain/projects.js';

/**
 * Turns what the user typed after `--project` into something to match against project
 * names: a path (`.`, `~/Workspace/site`, `/Users/me/site`) becomes its encoded name;
 * anything else (`site`, `Workspace-site`, the full encoded name) is kept as typed.
 */
export function projectQuery(raw: string, home: string, cwd: string): string {
  const looksLikePath =
    raw === '.' ||
    raw === '..' ||
    raw.startsWith('./') ||
    raw.startsWith('../') ||
    raw === '~' ||
    raw.startsWith('~/') ||
    isAbsolute(raw);
  if (!looksLikePath) return raw;
  const expanded = raw === '~' ? home : raw.startsWith('~/') ? `${home}${raw.slice(1)}` : raw;
  return encodeProjectPath(resolve(cwd, expanded));
}

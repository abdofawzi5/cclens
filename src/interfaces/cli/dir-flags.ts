import { homedir } from 'node:os';
import { resolve } from 'node:path';

/*
 * `--claude-dir` and `--cclens-home` pick the environment cclens reads and writes.
 * They are read from argv before anything else loads, because paths, the container,
 * the status line and child processes (ccusage, detached refreshes) all resolve their
 * directories from the environment. main.ts strips them and sets the variables below.
 */

export interface DirFlags {
  /** argv without the two flags and their values. */
  readonly argv: readonly string[];
  readonly claudeDir?: string | undefined;
  readonly cclensHome?: string | undefined;
}

const FLAGS = { '--claude-dir': 'claudeDir', '--cclens-home': 'cclensHome' } as const;
type FlagName = keyof typeof FLAGS;

function isFlag(name: string): name is FlagName {
  return Object.hasOwn(FLAGS, name);
}

/** Absolute path, with a leading `~` expanded. */
export function expandDir(dir: string, home: string = homedir()): string {
  if (dir === '~') return home;
  if (dir.startsWith('~/')) return resolve(home, dir.slice(2));
  return resolve(dir);
}

/**
 * Pulls `--claude-dir <dir>`, `--claude-dir=<dir>` (and the same for `--cclens-home`)
 * out of argv. Stops at `--`. Throws when a flag has no value.
 */
export function extractDirFlags(argv: readonly string[], home: string = homedir()): DirFlags {
  const rest: string[] = [];
  const found: { claudeDir?: string; cclensHome?: string } = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] as string;
    if (arg === '--') {
      rest.push(...argv.slice(i));
      break;
    }
    const eq = arg.indexOf('=');
    const name = eq === -1 ? arg : arg.slice(0, eq);
    if (!isFlag(name)) {
      rest.push(arg);
      continue;
    }
    let value: string | undefined;
    if (eq !== -1) value = arg.slice(eq + 1);
    else {
      value = argv[i + 1];
      i++;
    }
    if (value === undefined || value === '' || (eq === -1 && value.startsWith('-'))) {
      throw new Error(`${name} needs a directory`);
    }
    found[FLAGS[name]] = expandDir(value, home);
  }
  return { argv: rest, ...found };
}

/**
 * Sets the variables the rest of cclens reads. `CCLENS_CLAUDE_DIR` marks the Claude dir
 * as chosen on purpose, so only that environment is read (no desktop-app plugins);
 * `CLAUDE_CONFIG_DIR` passes it on to ccusage.
 */
export function applyDirFlags(flags: DirFlags, env: NodeJS.ProcessEnv = process.env): void {
  if (flags.claudeDir !== undefined) {
    env['CCLENS_CLAUDE_DIR'] = flags.claudeDir;
    env['CLAUDE_CONFIG_DIR'] = flags.claudeDir;
  } else if (env['CCLENS_CLAUDE_DIR']) {
    // Exported by the user instead of passed as a flag: ccusage must see it too.
    env['CLAUDE_CONFIG_DIR'] = env['CCLENS_CLAUDE_DIR'];
  }
  if (flags.cclensHome !== undefined) env['CCLENS_HOME'] = flags.cclensHome;
}

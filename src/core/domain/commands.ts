/**
 * Claude Code's own slash commands. Typing these is not a skill use, so they are
 * never recorded. Anything else typed as `/name` is treated as a skill or custom command.
 */
export const BUILTIN_COMMANDS: ReadonlySet<string> = new Set([
  'add-dir',
  'agents',
  'autocompact',
  'bashes',
  'bug',
  'clear',
  'compact',
  'config',
  'context',
  'cost',
  'doctor',
  'effort',
  'exit',
  'export',
  'fast',
  'feedback',
  'help',
  'hooks',
  'ide',
  'init',
  'install-github-app',
  'login',
  'logout',
  'mcp',
  'memory',
  'migrate-installer',
  'model',
  'output-style',
  'permissions',
  'plugin',
  'plugins',
  'pr-comments',
  'privacy-settings',
  'quit',
  'release-notes',
  'resume',
  'review',
  'rewind',
  'sandbox',
  'stats',
  'status',
  'statusline',
  'terminal-setup',
  'todos',
  'upgrade',
  'usage',
  'vim',
]);

const PROMPT_COMMAND = /^\s*\/([A-Za-z0-9][A-Za-z0-9:_.-]*)(?=\s|$)/;
const TAGGED_COMMAND = /<command-name>\/?([A-Za-z0-9][A-Za-z0-9:_.-]*)<\/command-name>/;

/**
 * Returns the skill/command name the user typed (`/write-article foo` → `write-article`),
 * or undefined for normal prompts and built-in commands. Also understands the
 * `<command-name>` tag Claude Code writes into transcripts.
 */
export function extractTypedCommand(text: string): string | undefined {
  const name = (PROMPT_COMMAND.exec(text) ?? TAGGED_COMMAND.exec(text))?.[1];
  if (!name || BUILTIN_COMMANDS.has(name.toLowerCase())) return undefined;
  return name;
}

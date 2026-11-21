import { ValidationError } from '../errors.js';

/**
 * Claude Code stores each project's transcripts in a folder named after the directory it
 * ran in, with every character other than a letter or digit turned into "-":
 * `/Users/me/Workspace/site` → `-Users-me-Workspace-site`.
 */
export function encodeProjectPath(absolutePath: string): string {
  return absolutePath.replace(/[^a-zA-Z0-9]/g, '-');
}

/**
 * Picks the one known project a query names. Tries, in order: the exact name; names
 * ending in `-<query>` (so `site` and `Workspace-site` both work); the same ignoring case.
 * Throws when nothing matches, or when several do at the first step that matches any.
 */
export function resolveProject(query: string, known: readonly string[]): string {
  if (known.includes(query)) return query;
  const suffix = `-${query.replace(/^-+/, '')}`;
  const steps: ((name: string) => boolean)[] = [
    (name) => name.endsWith(suffix),
    (name) => name.toLowerCase().endsWith(suffix.toLowerCase()),
  ];
  for (const matches of steps) {
    const found = known.filter(matches);
    if (found.length === 1) return found[0] as string;
    if (found.length > 1) {
      const names = [...found].sort();
      throw new ValidationError(
        `"${query}" matches ${names.length} projects; pass one of: ${names.join(', ')}`,
        names,
      );
    }
  }
  throw new ValidationError(
    `No project matches "${query}". Run \`cclens tokens project\` to see project names.`,
  );
}

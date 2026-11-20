import type { RepoRef } from '../domain/search.js';

const GITHUB_URL =
  /^(?:git\+)?(?:(?:https?|git|ssh):\/\/)?(?:git@)?(?:www\.)?github\.com[/:]([A-Za-z0-9-]+)\/([A-Za-z0-9._-]+?)(?:\.git)?(?:[/?#].*)?$/;
const SHORTHAND = /^([A-Za-z0-9-]+)\/([A-Za-z0-9._-]+)$/;

/**
 * Parses `https://github.com/o/r/tree/...`, `github.com/o/r`, `o/r`, and the git URLs
 * npm uses for `repository` (`git+https://…`, `git+ssh://git@github.com/…`, `git@github.com:o/r.git`).
 */
export function parseRepoRef(input: string): RepoRef | undefined {
  const trimmed = input.trim();
  const match = GITHUB_URL.exec(trimmed) ?? SHORTHAND.exec(trimmed);
  if (!match?.[1] || !match[2]) return undefined;
  return { owner: match[1], name: match[2] };
}

/** Case-insensitive key for merging results that point at the same repo. */
export function repoKey(ref: RepoRef): string {
  return `${ref.owner}/${ref.name}`.toLowerCase();
}

import { readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * Yields every `.jsonl` file under `dir`, recursively. Missing folders yield nothing.
 * With `modifiedSince`, files last written before that date are skipped (they cannot
 * hold newer lines), which keeps reviews of recent weeks fast.
 */
export async function* walkJsonl(dir: string, modifiedSince?: Date): AsyncIterable<string> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      yield* walkJsonl(path, modifiedSince);
    } else if (entry.isFile() && entry.name.endsWith('.jsonl')) {
      if (modifiedSince && (await modifiedBefore(path, modifiedSince))) continue;
      yield path;
    }
  }
}

async function modifiedBefore(path: string, date: Date): Promise<boolean> {
  try {
    return (await stat(path)).mtime < date;
  } catch {
    return true;
  }
}

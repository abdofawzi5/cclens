import { readdir, readFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { z } from 'zod';

const manifest = z.looseObject({ name: z.string().min(1) });

const SKIP = new Set(['node_modules', '.git', 'skills', 'commands', 'agents', 'hooks']);

/** An installed plugin folder and its name from `.claude-plugin/plugin.json`. */
export interface PluginDir {
  readonly dir: string;
  readonly name: string;
}

/**
 * Finds plugins anywhere under the given roots: a plugin is a folder with
 * `.claude-plugin/plugin.json`. Works for Claude Code (`~/.claude/plugins`) and the
 * Claude desktop app's plugin folders.
 */
export async function* findPlugins(
  roots: readonly string[],
  maxDepth = 6,
): AsyncIterable<PluginDir> {
  for (const root of roots) {
    for await (const dir of walk(root, 0, maxDepth)) yield { dir, name: await pluginName(dir) };
  }
}

async function* walk(dir: string, depth: number, maxDepth: number): AsyncIterable<string> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  if (entries.some((e) => e.isDirectory() && e.name === '.claude-plugin')) {
    yield dir;
    return;
  }
  if (depth >= maxDepth) return;
  for (const e of entries) {
    if (e.isDirectory() && !SKIP.has(e.name) && !e.name.startsWith('.')) {
      yield* walk(join(dir, e.name), depth + 1, maxDepth);
    }
  }
}

async function pluginName(dir: string): Promise<string> {
  try {
    const raw: unknown = JSON.parse(
      await readFile(join(dir, '.claude-plugin', 'plugin.json'), 'utf8'),
    );
    const parsed = manifest.safeParse(raw);
    if (parsed.success) return parsed.data.name;
  } catch {
    // Fall back to the folder name.
  }
  return basename(dir);
}

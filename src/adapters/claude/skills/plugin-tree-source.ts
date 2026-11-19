import { readdir, readFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { z } from 'zod';
import type { Skill } from '../../../core/domain/skill.js';
import type { SkillSource } from '../../../core/ports/skills.js';
import { readSkillsDir } from './read-skills-dir.js';

const manifest = z.looseObject({ name: z.string().min(1) });

const SKIP = new Set(['node_modules', '.git', 'skills', 'commands', 'agents', 'hooks']);

/**
 * Finds installed plugins anywhere under the given roots: a plugin is a folder with
 * `.claude-plugin/plugin.json`; its skills are `skills/<name>/SKILL.md`.
 * Works for Claude Code (`~/.claude/plugins`) and the Claude desktop app's plugin folders.
 * The same plugin found in several places is listed once.
 */
export class PluginTreeSource implements SkillSource {
  readonly id = 'plugins';

  constructor(
    private readonly roots: readonly string[],
    private readonly maxDepth = 6,
  ) {}

  async list(): Promise<readonly Skill[]> {
    const byId = new Map<string, Skill>();
    for (const root of this.roots) {
      for await (const dir of this.findPlugins(root, 0)) {
        const name = await this.pluginName(dir);
        for (const skill of await readSkillsDir(join(dir, 'skills'), 'plugin', name)) {
          if (!byId.has(skill.id)) byId.set(skill.id, skill);
        }
      }
    }
    return [...byId.values()].sort((a, b) => a.id.localeCompare(b.id));
  }

  private async *findPlugins(dir: string, depth: number): AsyncIterable<string> {
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
    if (depth >= this.maxDepth) return;
    for (const e of entries) {
      if (e.isDirectory() && !SKIP.has(e.name) && !e.name.startsWith('.')) {
        yield* this.findPlugins(join(dir, e.name), depth + 1);
      }
    }
  }

  private async pluginName(dir: string): Promise<string> {
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
}

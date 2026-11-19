import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parseSkillFrontmatter } from '../../../src/adapters/claude/skills/frontmatter.js';
import { PluginTreeSource } from '../../../src/adapters/claude/skills/plugin-tree-source.js';
import { SkillDirSource } from '../../../src/adapters/claude/skills/skill-dir-source.js';
import { CompositeSkillSource } from '../../../src/app/inventory/composite-skill-source.js';

async function skill(dir: string, name: string, front: string): Promise<void> {
  await mkdir(join(dir, name), { recursive: true });
  await writeFile(join(dir, name, 'SKILL.md'), front);
}

async function plugin(
  root: string,
  folder: string,
  name: string | null,
  skills: string[],
): Promise<void> {
  const dir = join(root, folder);
  await mkdir(join(dir, '.claude-plugin'), { recursive: true });
  await writeFile(
    join(dir, '.claude-plugin', 'plugin.json'),
    name === null ? '{ broken' : JSON.stringify({ name, version: '1.0.0' }),
  );
  for (const s of skills)
    await skill(join(dir, 'skills'), s, `---\nname: ${s}\ndescription: ${s} skill\n---\n`);
}

describe('parseSkillFrontmatter', () => {
  it('reads name and folded description', () => {
    expect(
      parseSkillFrontmatter(
        '---\nname: seo-audit\ndescription: >\n  Audit SEO.\n  Fast.\n---\n# Body',
      ),
    ).toEqual({ name: 'seo-audit', description: 'Audit SEO. Fast.' });
  });

  it.each([
    'no front matter',
    '---\n: : bad yaml [\n---\n',
    '---\n- a list\n---\n',
    '---\nname: 3\n---\n',
  ])('returns {} for %j', (text) => {
    expect(parseSkillFrontmatter(text)).toEqual({});
  });
});

describe('skill sources', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'cclens-skills-'));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('lists standalone skills, falling back to the folder name', async () => {
    const skills = join(dir, 'skills');
    await skill(
      skills,
      'write-article',
      '---\nname: write-article\ndescription: Write posts\n---\n',
    );
    await skill(skills, 'no-front', '# just markdown');
    await mkdir(join(skills, 'empty-folder'));
    await writeFile(join(skills, 'stray.txt'), 'x');
    const list = await new SkillDirSource('personal', skills, 'personal').list();
    expect(list.map((s) => [s.id, s.scope, s.description])).toEqual([
      ['no-front', 'personal', undefined],
      ['write-article', 'personal', 'Write posts'],
    ]);
    expect(await new SkillDirSource('project', join(dir, 'missing'), 'project').list()).toEqual([]);
  });

  it('finds plugins at any depth, dedupes copies, and qualifies ids', async () => {
    const cli = join(dir, 'claude', 'plugins');
    const desktop = join(dir, 'desktop');
    await plugin(cli, 'marketplaces/official/plugins/marketing', 'marketing', [
      'seo-audit',
      'email',
    ]);
    await plugin(desktop, 'sessions/a/b/rpm/plugin_1', 'marketing', ['seo-audit']);
    await plugin(desktop, 'sessions/a/b/rpm/plugin_2', 'engineering', ['debug']);
    await plugin(desktop, 'sessions/a/b/rpm/broken-manifest', null, ['x']);
    await mkdir(join(desktop, 'node_modules', 'pkg', '.claude-plugin'), { recursive: true });

    const list = await new PluginTreeSource([cli, desktop, join(dir, 'missing')]).list();
    expect(list.map((s) => s.id)).toEqual([
      'broken-manifest:x',
      'engineering:debug',
      'marketing:email',
      'marketing:seo-audit',
    ]);
    expect(list.find((s) => s.id === 'marketing:email')).toMatchObject({
      plugin: 'marketing',
      scope: 'plugin',
    });
  });

  it('respects the depth limit', async () => {
    await plugin(dir, 'a/b/c/deep', 'deep', ['s']);
    // The plugin folder is 4 levels below the root: a/b/c/deep.
    expect(await new PluginTreeSource([dir], 3).list()).toEqual([]);
    expect((await new PluginTreeSource([dir], 4).list()).map((s) => s.id)).toEqual(['deep:s']);
  });

  it('composite keeps the first source for duplicate ids', async () => {
    const a = {
      id: 'a',
      list: () => Promise.resolve([{ id: 'x', name: 'x', scope: 'personal' as const }]),
    };
    const b = {
      id: 'b',
      list: () =>
        Promise.resolve([
          { id: 'x', name: 'x', scope: 'project' as const },
          { id: 'y', name: 'y', scope: 'project' as const },
        ]),
    };
    const list = await new CompositeSkillSource([a, b]).list();
    expect(list.map((s) => [s.id, s.scope])).toEqual([
      ['x', 'personal'],
      ['y', 'project'],
    ]);
  });
});

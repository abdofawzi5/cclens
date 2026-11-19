import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CCLENS_PLUGIN_NAME, cclensHookSpecs } from '../../../src/core/domain/hooks.js';

const root = join(import.meta.dirname, '..', '..', '..');
const readJson = (...parts: string[]): unknown =>
  JSON.parse(readFileSync(join(root, ...parts), 'utf8'));

interface HooksFile {
  hooks: Record<string, { matcher?: string; hooks: { type: string; command: string }[] }[]>;
}
interface Marketplace {
  name: string;
  plugins: { name: string; source: string }[];
}

describe('Claude Code plugin package', () => {
  it('registers the same hooks as `cclens init`', () => {
    const file = readJson('plugin', 'hooks', 'hooks.json') as HooksFile;
    const plugin = Object.entries(file.hooks).flatMap(([event, groups]) =>
      groups.map((g) => ({ event, matcher: g.matcher })),
    );
    const init = cclensHookSpecs('x').map((s) => ({ event: s.event, matcher: s.matcher }));
    expect(plugin).toEqual(init);
    for (const groups of Object.values(file.hooks)) {
      for (const h of groups.flatMap((g) => g.hooks)) {
        expect(h.command).toContain('${CLAUDE_PLUGIN_ROOT}/hooks/record-skill-use.sh');
        // The plugin's own hooks must not look like settings.json hooks cclens owns.
        expect(h.command).not.toContain('CCLENS_HOOK=1');
      }
    }
  });

  it('keeps the plugin name and version in step with package.json', () => {
    const pkg = readJson('package.json') as { version: string; files: string[] };
    const plugin = readJson('plugin', '.claude-plugin', 'plugin.json') as {
      name: string;
      version: string;
    };
    expect(plugin.name).toBe(CCLENS_PLUGIN_NAME);
    expect(plugin.version).toBe(pkg.version);
    expect(pkg.files).toContain('plugin');
  });

  it('declares the bin the way npm publish keeps it', () => {
    // npm 11 drops bin paths written as "./dist/cli.js" when publishing.
    const pkg = readJson('package.json') as { bin: Record<string, string> };
    expect(pkg.bin).toEqual({ cclens: 'dist/cli.js' });
  });

  it('lists the plugin in the repo marketplace', () => {
    const market = readJson('.claude-plugin', 'marketplace.json') as Marketplace;
    expect(market.plugins).toEqual([
      expect.objectContaining({ name: CCLENS_PLUGIN_NAME, source: './plugin' }),
    ]);
    for (const p of [
      'plugin/.claude-plugin/plugin.json',
      'plugin/commands/cclens.md',
      'plugin/skills/cclens/SKILL.md',
    ]) {
      expect(existsSync(join(root, p)), p).toBe(true);
    }
  });
});

describe.skipIf(process.platform === 'win32')('plugin hook script', () => {
  const script = join(root, 'plugin', 'hooks', 'record-skill-use.sh');
  let dir: string;
  let env: NodeJS.ProcessEnv;
  const out = (): string => join(dir, 'out.txt');

  const run = (payload = '{"hook_event_name":"UserPromptSubmit","prompt":"/x"}'): void => {
    execFileSync('sh', [script], { input: payload, env, cwd: dir });
  };

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'cclens-plugin-hook-'));
    await mkdir(join(dir, 'claude'));
    // A stand-in CLI that records its arguments and stdin.
    await writeFile(
      join(dir, 'fake-cli.sh'),
      `printf '%s|' "$@" > "${out()}"; cat >> "${out()}"\n`,
    );
    env = {
      HOME: dir,
      PATH: '/usr/bin:/bin',
      CCLENS_HOME: join(dir, 'cclens'),
      CLAUDE_CONFIG_DIR: join(dir, 'claude'),
      CLAUDE_PROJECT_DIR: join(dir, 'proj'),
    };
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('runs the command saved by `cclens init`, passing the payload on stdin', async () => {
    await mkdir(join(dir, 'cclens'));
    await writeFile(
      join(dir, 'cclens', 'hook-runner'),
      `"/bin/sh" "${join(dir, 'fake-cli.sh')}"\n`,
    );
    run('{"p":1}');
    expect(await readFile(out(), 'utf8')).toBe('hook|{"p":1}');
  });

  it("passes the CLI's stdout through (budget warnings) and keeps stderr quiet", async () => {
    await mkdir(join(dir, 'cclens'));
    await writeFile(join(dir, 'loud-cli.sh'), `echo '{"systemMessage":"x"}'; echo oops >&2\n`);
    await writeFile(
      join(dir, 'cclens', 'hook-runner'),
      `"/bin/sh" "${join(dir, 'loud-cli.sh')}"\n`,
    );
    const result = spawnSync('sh', [script], { input: '{}', env, cwd: dir, encoding: 'utf8' });
    expect(result.status).toBe(0);
    expect(result.stdout).toBe('{"systemMessage":"x"}\n');
    expect(result.stderr).toBe('');
  });

  it('stands down when settings.json already has the cclens hooks', async () => {
    await mkdir(join(dir, 'cclens'));
    await writeFile(
      join(dir, 'cclens', 'hook-runner'),
      `"/bin/sh" "${join(dir, 'fake-cli.sh')}"\n`,
    );
    await mkdir(join(dir, 'proj', '.claude'), { recursive: true });
    await writeFile(
      join(dir, 'proj', '.claude', 'settings.json'),
      JSON.stringify({ hooks: { Stop: [{ hooks: [{ command: 'CCLENS_HOOK=1 x hook' }] }] } }),
    );
    run();
    expect(existsSync(out())).toBe(false);
  });

  it('logs a hint and still exits 0 when cclens cannot be found', async () => {
    run();
    expect(await readFile(join(dir, 'cclens', 'hook-errors.log'), 'utf8')).toContain(
      'cclens init --plugin',
    );
  });
});

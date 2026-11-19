import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { JsonSettingsManager } from '../../../src/adapters/claude/json-settings-manager.js';
import { resolvePaths } from '../../../src/adapters/system/paths.js';
import { InstallRunner } from '../../../src/app/install/install-runner.js';
import { createContainer, type Container } from '../../../src/composition-root.js';
import { ConfigError } from '../../../src/core/errors.js';
import type { InstallStep } from '../../../src/core/ports/install.js';
import type { DoctorService } from '../../../src/app/doctor-service.js';
import { buildServices } from '../../../src/interfaces/cli/program.js';
import { FixedClock } from '../../support/fakes.js';

const LEGACY = {
  hooks: {
    PostToolUse: [
      {
        matcher: 'Skill',
        hooks: [{ type: 'command', command: '~/.claude/hooks/log-skill-usage.sh' }],
      },
      { matcher: 'Bash', hooks: [{ type: 'command', command: 'echo keep-me' }] },
    ],
    UserPromptSubmit: [
      { hooks: [{ type: 'command', command: '~/.claude/hooks/log-skill-usage.sh' }] },
    ],
  },
  model: 'opus',
};

describe('JsonSettingsManager', () => {
  let dir: string;
  let manager: JsonSettingsManager;
  const userFile = (): string => join(dir, 'claude', 'settings.json');

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'cclens-settings-'));
    manager = new JsonSettingsManager(
      join(dir, 'claude'),
      join(dir, 'proj'),
      join(dir, 'backups'),
      new FixedClock(),
    );
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('resolves user and project paths', () => {
    expect(manager.settingsPath('user')).toBe(userFile());
    expect(manager.settingsPath('project')).toBe(join(dir, 'proj', '.claude', 'settings.json'));
  });

  it('adds hooks idempotently, preserving unrelated settings', async () => {
    await mkdir(join(dir, 'claude'));
    await writeFile(userFile(), JSON.stringify(LEGACY));
    const spec = {
      event: 'PostToolUse' as const,
      matcher: 'Skill',
      command: 'CCLENS_HOOK=1 x hook',
    };
    expect(await manager.addHooks('user', [spec])).toEqual([spec]);
    expect(await manager.addHooks('user', [spec])).toEqual([]);
    const saved = JSON.parse(await readFile(userFile(), 'utf8')) as typeof LEGACY;
    expect(saved.model).toBe('opus');
    expect(saved.hooks.PostToolUse).toHaveLength(3);
    expect(await manager.listHooks('user')).toHaveLength(4);
  });

  it('removes matching hooks and drops empty groups and events', async () => {
    await mkdir(join(dir, 'claude'));
    await writeFile(userFile(), JSON.stringify(LEGACY));
    expect(await manager.removeHooks('user', (c) => c.includes('log-skill-usage'))).toBe(2);
    const saved = JSON.parse(await readFile(userFile(), 'utf8')) as Record<string, unknown>;
    expect(saved).toEqual({
      hooks: {
        PostToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'echo keep-me' }] }],
      },
      model: 'opus',
    });
    expect(await manager.removeHooks('user', () => true)).toBe(1);
    expect(JSON.parse(await readFile(userFile(), 'utf8'))).toEqual({ model: 'opus' });
    expect(await manager.removeHooks('user', () => true)).toBe(0);
  });

  it('backs up and restores, including when the file did not exist', async () => {
    const missing = await manager.backup('project');
    expect(missing.existed).toBe(false);
    await manager.addHooks('project', [{ event: 'Stop', command: 'CCLENS_HOOK=1 y' }]);
    await manager.restore(missing);
    expect(await manager.listHooks('project')).toEqual([]);

    await mkdir(join(dir, 'claude'));
    await writeFile(userFile(), '{"a":1}');
    const backup = await manager.backup('user');
    expect(backup.existed).toBe(true);
    await writeFile(userFile(), '{"a":2}');
    await manager.restore(backup);
    expect(await readFile(userFile(), 'utf8')).toBe('{"a":1}');
  });

  it('lists enabled plugins and ignores odd values', async () => {
    await mkdir(join(dir, 'claude'));
    expect(await manager.enabledPlugins('user')).toEqual([]);
    await writeFile(
      userFile(),
      JSON.stringify({ enabledPlugins: { 'cclens@cclens': true, 'off@m': false, 'odd@m': 'yes' } }),
    );
    expect(await manager.enabledPlugins('user')).toEqual(['cclens@cclens']);
    await writeFile(userFile(), JSON.stringify({ enabledPlugins: ['not', 'a', 'map'] }));
    expect(await manager.enabledPlugins('user')).toEqual([]);
  });

  it('refuses to edit malformed settings', async () => {
    await mkdir(join(dir, 'claude'));
    await writeFile(userFile(), '{ broken');
    await expect(manager.listHooks('user')).rejects.toBeInstanceOf(ConfigError);
    await writeFile(userFile(), JSON.stringify({ hooks: { PostToolUse: 'nope' } }));
    await expect(manager.listHooks('user')).rejects.toThrow(/unexpected "hooks" shape/);
    await writeFile(userFile(), '   ');
    expect(await manager.listHooks('user')).toEqual([]);
  });
});

describe('InstallRunner', () => {
  it('undoes completed steps in reverse when a step fails', async () => {
    const log: string[] = [];
    const step = (id: string, fail = false): InstallStep => ({
      id,
      title: id,
      execute: () => {
        if (fail) return Promise.reject(new Error('boom'));
        log.push(`do ${id}`);
        return Promise.resolve({ status: 'done', message: id });
      },
      undo: () => {
        log.push(`undo ${id}`);
        return id === 'b' ? Promise.reject(new Error('undo failed')) : Promise.resolve();
      },
    });
    const report = await new InstallRunner().run([step('a'), step('b'), step('c', true)]);
    expect(report.ok).toBe(false);
    expect(report.error).toBe('c: boom');
    expect(report.rolledBack).toEqual(['a']);
    expect(log).toEqual(['do a', 'do b', 'undo b', 'undo a']);
  });
});

describe('init / doctor / uninstall end to end (temp home)', () => {
  let dir: string;
  let container: Container;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'cclens-e2e-'));
    const paths = resolvePaths({
      CCLENS_HOME: join(dir, 'cclens'),
      CLAUDE_CONFIG_DIR: join(dir, 'claude'),
    });
    container = createContainer({
      cwd: join(dir, 'proj'),
      overrides: { paths, selfCommand: `"${process.execPath}" "${join(dir, 'cli.js')}"` },
    });
    await writeFile(join(dir, 'cli.js'), '');
    await mkdir(join(dir, 'claude', 'projects', 'p'), { recursive: true });
    await writeFile(join(dir, 'claude', 'settings.json'), JSON.stringify(LEGACY));
    await writeFile(
      join(dir, 'claude', 'skill-usage.log'),
      '2026-11-15 09:00:00\tauto\tpostiz:postiz\tsite\n',
    );
    await writeFile(
      join(dir, 'claude', 'projects', 'p', 's.jsonl'),
      `${JSON.stringify({ type: 'assistant', timestamp: '2026-11-14T10:00:00.000Z', sessionId: 's', cwd: '/x/site', message: { content: [{ type: 'tool_use', id: 't1', name: 'Skill', input: { skill: 'a:b' } }] } })}\n`,
    );
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('dry run changes nothing', async () => {
    const { setup } = buildServices(container);
    const report = await setup.init({
      scope: 'user',
      backfill: true,
      migrateLegacy: true,
      dryRun: true,
    });
    expect(report.ok).toBe(true);
    expect(JSON.parse(await readFile(join(dir, 'claude', 'settings.json'), 'utf8'))).toEqual(
      LEGACY,
    );
    await expect(readdir(join(dir, 'cclens'))).rejects.toThrow();
  });

  it('sets up, migrates, backfills, is re-runnable, passes doctor, and uninstalls cleanly', async () => {
    const { setup, doctor, usage } = buildServices(container);
    const before = await doctor.run();
    expect(before.find((r) => r.id === 'hooks')?.status).toBe('fail');
    expect(before.find((r) => r.id === 'legacy-hook')?.status).toBe('warn');

    const report = await setup.init({
      scope: 'user',
      backfill: true,
      migrateLegacy: true,
      dryRun: false,
    });
    expect(report.ok).toBe(true);
    expect(report.steps.map((s) => [s.id, s.status])).toEqual([
      ['config', 'done'],
      ['event-log', 'done'],
      ['backup-settings', 'done'],
      ['legacy-hook', 'done'],
      ['hooks', 'done'],
      ['hook-runner', 'done'],
      ['import-legacy-log', 'done'],
      ['import-transcripts', 'done'],
    ]);
    expect([...(await usage.countBySkill())]).toEqual([
      ['a:b', 1],
      ['postiz:postiz', 1],
    ]);

    const settings = JSON.parse(
      await readFile(join(dir, 'claude', 'settings.json'), 'utf8'),
    ) as typeof LEGACY;
    expect(JSON.stringify(settings)).not.toContain('log-skill-usage');
    expect(JSON.stringify(settings)).toContain('echo keep-me');
    expect(settings.model).toBe('opus');

    const again = await setup.init({
      scope: 'user',
      backfill: true,
      migrateLegacy: true,
      dryRun: false,
    });
    expect(again.steps.filter((s) => s.status === 'done').map((s) => s.id)).toEqual([
      'backup-settings',
    ]);
    expect(await usage.total()).toBe(2);

    const after = await doctor.run();
    expect(after.map((r) => [r.id, r.status])).toEqual([
      ['node', 'ok'],
      ['config', 'ok'],
      ['budget', 'ok'],
      ['event-log', 'ok'],
      ['hooks', 'ok'],
      ['hook-owner', 'ok'],
      ['hook-target', 'ok'],
      ['legacy-hook', 'ok'],
    ]);
    expect(await readFile(join(dir, 'cclens', 'hook-runner'), 'utf8')).toBe(
      `${container.selfCommand}\n`,
    );

    expect(await setup.uninstall()).toEqual({ removed: { user: 2, project: 0 } });
    const final = JSON.parse(
      await readFile(join(dir, 'claude', 'settings.json'), 'utf8'),
    ) as Record<string, unknown>;
    expect(final).toEqual({
      hooks: {
        PostToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'echo keep-me' }] }],
      },
      model: 'opus',
    });
    expect((await readdir(join(dir, 'cclens', 'backups'))).length).toBe(2);
  });

  it('doctor flags a hook that points at a missing file', async () => {
    const { setup, doctor } = buildServices(container);
    await setup.init({ scope: 'user', backfill: false, migrateLegacy: false, dryRun: false });
    await rm(join(dir, 'cli.js'));
    const target = (await doctor.run()).find((r) => r.id === 'hook-target');
    expect(target?.status).toBe('fail');
    expect(target?.message).toContain('cli.js');
  });

  const enablePlugin = async (): Promise<void> => {
    const file = join(dir, 'claude', 'settings.json');
    const current = JSON.parse(await readFile(file, 'utf8')) as Record<string, unknown>;
    await writeFile(
      file,
      JSON.stringify({ ...current, enabledPlugins: { 'cclens@cclens': true } }),
    );
  };
  const statuses = async (doctor: DoctorService): Promise<Record<string, string>> =>
    Object.fromEntries((await doctor.run()).map((r) => [r.id, r.status]));

  it('plugin mode keeps cclens hooks out of settings.json and saves the runner', async () => {
    const { setup, doctor } = buildServices(container);
    await setup.init({ scope: 'user', backfill: false, migrateLegacy: false, dryRun: false });
    await enablePlugin();
    const both = await statuses(doctor);
    expect(both['hooks']).toBe('ok');
    expect(both['hook-owner']).toBe('warn');

    const report = await setup.init({
      scope: 'user',
      hooks: 'plugin',
      backfill: false,
      migrateLegacy: false,
      dryRun: false,
    });
    expect(report.steps.find((s) => s.id === 'hooks')?.status).toBe('done');
    expect(JSON.stringify(await container.settings.listHooks('user'))).not.toContain(
      'CCLENS_HOOK=1',
    );
    expect(await statuses(doctor)).toMatchObject({
      hooks: 'ok',
      'hook-owner': 'ok',
      'hook-target': 'ok',
    });
    const again = await setup.init({
      scope: 'user',
      hooks: 'plugin',
      backfill: false,
      migrateLegacy: false,
      dryRun: true,
    });
    expect(again.steps.filter((s) => s.status === 'skipped').map((s) => s.id)).toEqual([
      'config',
      'event-log',
      'hooks',
      'hook-runner',
    ]);
  });

  it('doctor flags a plugin that has no saved runner', async () => {
    const { doctor } = buildServices(container);
    await enablePlugin();
    const target = (await doctor.run()).find((r) => r.id === 'hook-target');
    expect(target?.status).toBe('fail');
    expect(target?.fix).toContain('cclens init --plugin');
    await mkdir(join(dir, 'cclens'), { recursive: true });
    await writeFile(join(dir, 'cclens', 'hook-runner'), `"${join(dir, 'gone.js')}"\n`);
    const stale = (await doctor.run()).find((r) => r.id === 'hook-target');
    expect(stale?.status).toBe('fail');
    expect(stale?.message).toContain('gone.js');
  });
});

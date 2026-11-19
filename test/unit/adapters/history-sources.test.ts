import { collect } from '../../support/fakes.js';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LegacyLogSource } from '../../../src/adapters/claude/history/legacy-log-source.js';
import { TranscriptSource } from '../../../src/adapters/claude/history/transcript-source.js';

const FIXTURES = join(import.meta.dirname, '..', '..', 'fixtures', 'transcripts');

describe('TranscriptSource', () => {
  it('finds Skill tool uses (deduplicated, including subagents) and typed skills', async () => {
    const events = await collect(new TranscriptSource(FIXTURES).read());
    const simplified = events
      .map((e) => [e.ts.toISOString(), e.source, e.skill, e.project, e.sessionId])
      .sort((a, b) => String(a[0]).localeCompare(String(b[0])));
    expect(simplified).toEqual([
      ['2026-11-16T10:00:00.000Z', 'backfill', 'write-article', 'project', 'sess-1'],
      ['2026-11-16T10:02:00.000Z', 'backfill', 'marketing:seo-audit', 'project', 'sess-1'],
      ['2026-11-17T09:00:00.000Z', 'backfill', 'remotion:remotion-render', 'project', 'sess-1'],
    ]);
  });

  it('honours since and tolerates a missing directory', async () => {
    const since = await collect(
      new TranscriptSource(FIXTURES).read(new Date('2026-11-17T00:00:00Z')),
    );
    expect(since.map((e) => e.skill)).toEqual(['remotion:remotion-render']);
    expect(await collect(new TranscriptSource('/nope/missing').read())).toEqual([]);
  });
});

describe('LegacyLogSource', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'cclens-legacy-'));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('parses tab-separated lines in local time and skips junk', async () => {
    const file = join(dir, 'skill-usage.log');
    await writeFile(
      file,
      [
        '2026-11-19 17:46:49\tauto\tmarketing:seo-audit\tgeekDevelopers',
        'junk',
        '2026-11-19 18:00:00\ttyped\twrite-article',
        '2026-11-19 99:00\tauto\tx\ty',
        '',
      ].join('\n'),
    );
    const events = await collect(new LegacyLogSource(file).read());
    expect(events.map((e) => [e.ts.getHours(), e.source, e.skill, e.project])).toEqual([
      [17, 'legacy', 'marketing:seo-audit', 'geekDevelopers'],
      [18, 'legacy', 'write-article', ''],
    ]);
    const later = await collect(new LegacyLogSource(file).read(new Date(2026, 10, 19, 17, 50)));
    expect(later).toHaveLength(1);
  });

  it('yields nothing when the log is missing', async () => {
    expect(await collect(new LegacyLogSource(join(dir, 'missing')).read())).toEqual([]);
  });
});

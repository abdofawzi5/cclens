import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  buildPrompt,
  ClaudeCliReviewer,
  parseReview,
} from '../../src/adapters/claude/review/claude-cli-reviewer.js';
import type { Recommendation } from '../../src/core/domain/recommendation.js';
import { IntegrationError } from '../../src/core/errors.js';
import type { ProcessResult, ProcessRunner } from '../../src/core/ports/infrastructure.js';
import { activity, day, reviewContext, session } from '../support/review.js';

const fixture = (name: string): string =>
  readFileSync(join(import.meta.dirname, '..', 'fixtures', 'claude', name), 'utf8');

class FakeRunner implements ProcessRunner {
  calls: { command: string; args: readonly string[]; input?: string }[] = [];
  constructor(private readonly respond: () => ProcessResult | Error) {}
  run(
    command: string,
    args: readonly string[],
    options?: { input?: string },
  ): Promise<ProcessResult> {
    this.calls.push({ command, args, ...(options?.input ? { input: options.input } : {}) });
    const r = this.respond();
    return r instanceof Error ? Promise.reject(r) : Promise.resolve(r);
  }
}

const ok = (stdout: string): ProcessResult => ({ exitCode: 0, stdout, stderr: '' });

const ctx = reviewContext({
  daily: [
    day('2026-11-19', { cacheRead: 100 }, [
      {
        model: 'claude-opus-5-5',
        costUsd: 3.456,
        counts: { input: 0, output: 0, cacheCreation: 0, cacheRead: 100 },
      },
    ]),
  ],
  sessions: [session('abcdef1234', { cacheRead: 100 })],
  activity: [activity('abcdef1234', { autoCompactions: 2, peakContextTokens: 1000 })],
  installedSkills: [
    { id: 'mkt:seo', name: 'seo', scope: 'plugin', plugin: 'mkt' },
    { id: 'solo', name: 'solo', scope: 'personal' },
  ],
  skillUseCounts: new Map([['mkt:seo', 4]]),
});
const findings: Recommendation[] = [
  { ruleId: 'long-sessions', severity: 'warn', title: 'Long sessions', detail: 'd', actions: [] },
];

describe('ClaudeCliReviewer (contract, claude -p --output-format json)', () => {
  it('runs claude headless with tools, MCP and saving disabled and a budget cap', async () => {
    const runner = new FakeRunner(() => ok(fixture('success.json')));
    const recs = await new ClaudeCliReviewer(runner, { model: 'haiku', maxBudgetUsd: 0.1 }).review(
      ctx,
      findings,
    );
    const call = runner.calls[0];
    expect(call?.command).toBe('claude');
    expect(call?.args).toEqual([
      '-p',
      '--output-format',
      'json',
      '--no-session-persistence',
      '--model',
      'haiku',
      '--tools',
      '',
      '--strict-mcp-config',
      '--disable-slash-commands',
      '--max-budget-usd',
      '0.1',
    ]);
    expect(recs).toEqual([
      {
        ruleId: 'ai',
        severity: 'warn',
        title: 'Two projects account for most spend',
        detail: 'Most cost comes from two projects.',
        actions: ['Review CLAUDE.md size in those projects'],
      },
      {
        ruleId: 'ai',
        severity: 'info',
        title: 'Short sessions are cheap',
        detail: 'Keep doing them.',
        actions: [],
      },
    ]);
  });

  it('sends aggregates only: no home paths, rule findings listed', () => {
    const prompt = buildPrompt(ctx, findings, 5);
    expect(prompt).toContain('"project":"site"');
    expect(prompt).not.toContain('-Users-me');
    expect(prompt).toContain('"id":"abcdef12"');
    expect(prompt).toContain('"claude-opus-5-5":3.46');
    expect(prompt).toContain('"mkt":{"skills":1,"uses":4}');
    expect(prompt).toContain('"(standalone)":{"skills":1,"uses":0}');
    expect(prompt).toContain('"rule":"long-sessions"');
    expect(prompt).toContain('at most 5 further');
  });

  it('explains a missing login', () => {
    expect(() => parseReview(fixture('not-logged-in.json'), '', 0, 5)).toThrow(
      /Not logged in.*sign in/,
    );
  });

  it.each([
    ['not json', /claude -p failed: not json/],
    [JSON.stringify({ type: 'other' }), /changed format/],
    [
      JSON.stringify({ type: 'result', is_error: true, result: 'Budget exceeded' }),
      /Budget exceeded\.$/,
    ],
    [
      JSON.stringify({ type: 'result', is_error: false, result: 'No list here' }),
      /did not return a JSON list/,
    ],
    [JSON.stringify({ type: 'result', is_error: false, result: '[oops]' }), /invalid JSON/],
    [
      JSON.stringify({ type: 'result', is_error: false, result: '[{"title":"x"}]' }),
      /expected shape/,
    ],
  ])('rejects bad output %#', (stdout, message) => {
    expect(() => parseReview(stdout, '', 0, 5)).toThrow(message);
  });

  it('uses stderr when stdout is empty, caps the number of findings', () => {
    expect(() => parseReview('', 'command crashed', 1, 5)).toThrow(/command crashed/);
    expect(() => parseReview('', '', 3, 5)).toThrow(/exit 3/);
    const many = JSON.stringify({
      type: 'result',
      is_error: false,
      result: JSON.stringify(
        Array.from({ length: 4 }, (_, i) => ({ severity: 'info', title: `t${i}`, detail: '' })),
      ),
    });
    expect(parseReview(many, '', 0, 2)).toHaveLength(2);
  });

  it('reports a missing claude binary as an IntegrationError', async () => {
    const runner = new FakeRunner(() => new Error('spawn claude ENOENT'));
    const error = await new ClaudeCliReviewer(runner).review(ctx, []).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(IntegrationError);
    expect((error as Error).message).toMatch(/Is Claude Code installed/);
  });
});

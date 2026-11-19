import { z } from 'zod';
import type { Recommendation } from '../../../core/domain/recommendation.js';
import type { ReviewContext } from '../../../core/domain/review.js';
import { totalTokens } from '../../../core/domain/tokens.js';
import { IntegrationError } from '../../../core/errors.js';
import type { ProcessRunner } from '../../../core/ports/infrastructure.js';
import type { AiReviewer } from '../../../core/ports/review.js';

export interface ClaudeCliReviewerOptions {
  /** Command that starts Claude Code (default `claude`). */
  readonly command?: string;
  readonly model?: string;
  /** Hard spending cap for the review call, passed as `--max-budget-usd`. */
  readonly maxBudgetUsd?: number;
  readonly timeoutMs?: number;
  readonly maxFindings?: number;
}

/** `claude -p --output-format json` result envelope (only the fields we use). */
const envelope = z.looseObject({
  type: z.literal('result'),
  is_error: z.boolean(),
  result: z.string(),
});

const finding = z.object({
  severity: z.enum(['info', 'warn', 'high']),
  title: z.string().min(1),
  detail: z.string(),
  actions: z.array(z.string()).default([]),
});

/** Last path-like segment of an encoded project folder, so home paths are not sent. */
const projectName = (encoded: string): string => encoded.split('-').filter(Boolean).at(-1) ?? '';

/**
 * AiReviewer over headless Claude Code (`claude -p`). It uses the user's own Claude
 * login and sends only aggregate numbers and the rule findings, never transcripts
 * or prompts. Tools, MCP servers and slash commands are disabled for the call, the
 * session is not saved, and spending is capped.
 */
export class ClaudeCliReviewer implements AiReviewer {
  private readonly options: Required<ClaudeCliReviewerOptions>;

  constructor(
    private readonly runner: ProcessRunner,
    options: ClaudeCliReviewerOptions = {},
  ) {
    this.options = {
      command: 'claude',
      model: 'sonnet',
      maxBudgetUsd: 0.5,
      timeoutMs: 180_000,
      maxFindings: 5,
      ...options,
    };
  }

  async review(
    ctx: ReviewContext,
    ruleFindings: readonly Recommendation[],
  ): Promise<readonly Recommendation[]> {
    const o = this.options;
    const args = [
      '-p',
      '--output-format',
      'json',
      '--no-session-persistence',
      '--model',
      o.model,
      '--tools',
      '',
      '--strict-mcp-config',
      '--disable-slash-commands',
      '--max-budget-usd',
      String(o.maxBudgetUsd),
    ];
    let result;
    try {
      result = await this.runner.run(o.command, args, {
        input: buildPrompt(ctx, ruleFindings, o.maxFindings),
        timeoutMs: o.timeoutMs,
      });
    } catch (cause) {
      throw new IntegrationError(
        'claude',
        `Could not run \`${o.command}\`. Is Claude Code installed?`,
        {
          cause,
        },
      );
    }
    return parseReview(result.stdout, result.stderr, result.exitCode, o.maxFindings);
  }
}

/** Builds the prompt: instructions plus a JSON summary of aggregates only. */
export function buildPrompt(
  ctx: ReviewContext,
  findings: readonly Recommendation[],
  maxFindings: number,
): string {
  const byModel = new Map<string, number>();
  for (const day of ctx.daily) {
    for (const m of day.byModel ?? [])
      byModel.set(m.model, (byModel.get(m.model) ?? 0) + m.costUsd);
  }
  const activity = new Map(ctx.activity.map((a) => [a.sessionId, a]));
  const plugins = new Map<string, { skills: number; uses: number }>();
  for (const s of ctx.installedSkills) {
    const key = s.plugin ?? '(standalone)';
    const p = plugins.get(key) ?? { skills: 0, uses: 0 };
    p.skills += 1;
    p.uses += ctx.skillUseCounts.get(s.id) ?? 0;
    plugins.set(key, p);
  }

  const summary = {
    scope: ctx.scope.kind,
    windowDays: ctx.windowDays,
    days: ctx.daily.map((d) => ({
      day: d.period,
      tokens: totalTokens(d.counts),
      costUsd: round(d.costUsd),
    })),
    costByModelUsd: Object.fromEntries([...byModel].map(([m, c]) => [m, round(c)])),
    sessions: [...ctx.sessions]
      .sort((a, b) => b.costUsd - a.costUsd)
      .slice(0, 15)
      .map((s) => {
        const a = activity.get(s.sessionId);
        return {
          id: s.sessionId.slice(0, 8),
          project: projectName(s.project),
          hours: round((s.lastActivity.getTime() - s.firstActivity.getTime()) / 3_600_000),
          tokens: s.counts,
          costUsd: round(s.costUsd),
          models: s.models,
          prompts: a?.prompts,
          autoCompactions: a?.autoCompactions,
          peakContextTokens: a?.peakContextTokens,
        };
      }),
    skills: {
      installed: ctx.installedSkills.length,
      byPlugin: Object.fromEntries(plugins),
    },
    ruleFindings: findings.map((f) => ({ rule: f.ruleId, title: f.title })),
  };

  return [
    'You review how someone uses Claude Code and suggest ways to use fewer tokens and stay within plan limits.',
    'Below is a JSON summary of their recent usage. Costs are estimates at API list prices.',
    'Automated rules already reported the findings in `ruleFindings`; do not repeat them.',
    `Give at most ${maxFindings} further, specific suggestions grounded in the numbers.`,
    'Reply with ONLY a JSON array, no prose, where each item is',
    '{"severity": "info" | "warn" | "high", "title": string, "detail": string, "actions": string[]}.',
    'Reply with [] if there is nothing useful to add.',
    '',
    JSON.stringify(summary),
  ].join('\n');
}

/** Validates the `claude -p` output and turns it into recommendations. */
export function parseReview(
  stdout: string,
  stderr: string,
  exitCode: number,
  maxFindings: number,
): readonly Recommendation[] {
  let raw: unknown;
  try {
    raw = JSON.parse(stdout);
  } catch {
    const why = stderr.trim() || stdout.trim() || `exit ${exitCode}`;
    throw new IntegrationError('claude', `claude -p failed: ${why.slice(0, 300)}`);
  }
  const env = envelope.safeParse(raw);
  if (!env.success) {
    throw new IntegrationError(
      'claude',
      'Unexpected claude -p output; it may have changed format.',
    );
  }
  if (env.data.is_error) {
    const hint = /log ?in/i.test(env.data.result)
      ? ' Run `claude` and sign in, then try again.'
      : '';
    throw new IntegrationError('claude', `claude -p: ${env.data.result}.${hint}`);
  }

  const text = env.data.result;
  const start = text.indexOf('[');
  const end = text.lastIndexOf(']');
  if (start === -1 || end < start) {
    throw new IntegrationError('claude', 'The AI review did not return a JSON list.');
  }
  let list: unknown;
  try {
    list = JSON.parse(text.slice(start, end + 1));
  } catch (cause) {
    throw new IntegrationError('claude', 'The AI review returned invalid JSON.', { cause });
  }
  const parsed = z.array(finding).safeParse(list);
  if (!parsed.success) {
    throw new IntegrationError('claude', 'The AI review did not match the expected shape.');
  }
  return parsed.data.slice(0, maxFindings).map((f) => ({ ruleId: 'ai', ...f }));
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}

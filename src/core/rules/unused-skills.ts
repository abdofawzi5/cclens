import type { Recommendation, Severity } from '../domain/recommendation.js';
import type { ReviewContext } from '../domain/review.js';
import type { Skill } from '../domain/skill.js';
import type { OptimizationRule } from '../ports/review.js';
import { estimateTokens } from '../util/estimate-tokens.js';
import { compact, localDay } from '../util/format.js';

export interface UnusedSkillsOptions {
  /** Above this many listing tokens the finding is a warning, not a tip. */
  readonly warnAboveTokens: number;
  /** How many plugins to name in the detail. */
  readonly listTop: number;
}

const DEFAULTS: UnusedSkillsOptions = { warnAboveTokens: 5_000, listTop: 5 };

interface Group {
  readonly name: string;
  readonly isPlugin: boolean;
  readonly skills: Skill[];
  uses: number;
  tokens: number;
}

/** Tokens a skill adds to every request: Claude Code lists each one as `name: description`. */
export function skillListingTokens(skill: Skill): number {
  return estimateTokens(`- ${skill.id}: ${skill.description ?? ''}`);
}

/**
 * Plugins (and standalone skills) with no recorded use in the window.
 * Every installed skill's name and description is sent with each request, so
 * skills you never use still cost tokens.
 */
export class UnusedSkillsRule implements OptimizationRule {
  readonly id = 'unused-skills';
  readonly description = 'Installed plugins and skills with no recorded use in the review window';
  readonly defaultSeverity: Severity = 'warn';
  readonly appliesTo = ['window'] as const;
  private readonly options: UnusedSkillsOptions;

  constructor(options: Partial<UnusedSkillsOptions> = {}) {
    this.options = { ...DEFAULTS, ...options };
  }

  evaluate(ctx: ReviewContext): readonly Recommendation[] {
    const groups = new Map<string, Group>();
    for (const skill of ctx.installedSkills) {
      const key = skill.plugin ?? `skill:${skill.id}`;
      let g = groups.get(key);
      if (!g) {
        g = {
          name: skill.plugin ?? skill.id,
          isPlugin: skill.plugin !== undefined,
          skills: [],
          uses: 0,
          tokens: 0,
        };
        groups.set(key, g);
      }
      g.skills.push(skill);
      g.uses += ctx.skillUseCounts.get(skill.id) ?? 0;
      g.tokens += skillListingTokens(skill);
    }

    const unused = [...groups.values()]
      .filter((g) => g.uses === 0)
      .sort((a, b) => b.tokens - a.tokens);
    if (unused.length === 0) return [];

    const skills = unused.reduce((n, g) => n + g.skills.length, 0);
    const tokens = unused.reduce((n, g) => n + g.tokens, 0);
    const plugins = unused.filter((g) => g.isPlugin);
    const top = plugins
      .slice(0, this.options.listTop)
      .map((g) => `${g.name} (${g.skills.length} skills, ~${compact(g.tokens)} tokens)`);

    const lines = [
      `${skills} of ${ctx.installedSkills.length} installed skills had no recorded use in the last ${ctx.windowDays} days.`,
      `Their names and descriptions add up to about ${compact(tokens)} tokens. Claude Code shortens the list when it is long, so the real cost per request is lower, but a long list also hides the descriptions of skills you do use, which makes Claude pick them less reliably.`,
    ];
    if (top.length > 0) lines.push(`Largest unused plugins: ${top.join(', ')}.`);
    const tracked = ctx.usageTrackedSince;
    if (!tracked || tracked > ctx.since) {
      lines.push(
        tracked
          ? `cclens has recorded skill uses only since ${localDay(tracked)}, so older uses are not counted.`
          : 'cclens has not recorded any skill use yet, so treat this as a starting point.',
      );
    }
    lines.push('Uses outside Claude Code (for example in Cowork) are not recorded.');

    const actions = [
      'cclens skills --unused --by-plugin   # see what is unused',
      'Claude Code plugins: claude plugin disable <name>',
      'Claude desktop app plugins: turn them off in the app’s plugin settings',
    ];

    return [
      {
        ruleId: this.id,
        severity: tokens > this.options.warnAboveTokens ? 'warn' : 'info',
        title: `${skills} installed skills unused in ${ctx.windowDays} days`,
        detail: lines.join(' '),
        estimatedTokenSavings: tokens,
        savingsBasis: 'per-request',
        actions,
      },
    ];
  }
}

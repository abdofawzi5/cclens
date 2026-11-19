import type { RecordInput, UsageService } from '../../app/usage-service.js';
import { extractTypedCommand } from '../../core/domain/commands.js';
import { describeError } from '../../core/errors.js';
import type { Logger } from '../../core/ports/infrastructure.js';
import { hookPayloadSchema, type HookPayload } from './hook-payload.js';

export type HookResult = (
  | { readonly kind: 'recorded'; readonly skill: string }
  | { readonly kind: 'ignored'; readonly reason: string }
  | { readonly kind: 'error'; readonly reason: string }
) & {
  /** A budget warning to show (UserPromptSubmit only). */
  readonly warning?: string;
};

/** Claude Code hook JSON output: shown to the user and added to Claude's context. */
export function hookOutput(warning: string): string {
  return JSON.stringify({
    systemMessage: warning,
    hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: warning },
  });
}

function projectName(cwd: string | undefined): string {
  if (!cwd) return '';
  const parts = cwd.split(/[\\/]/).filter(Boolean);
  return parts.at(-1) ?? '';
}

/** Maps a hook payload to the usage event it represents, if any. Pure. */
export function toRecordInput(payload: HookPayload): RecordInput | undefined {
  const session = payload.session_id === undefined ? {} : { sessionId: payload.session_id };
  const project = projectName(payload.cwd);
  if (payload.hook_event_name === 'PostToolUse') {
    const skill = payload.tool_name === 'Skill' ? payload.tool_input?.['skill'] : undefined;
    return typeof skill === 'string' && skill
      ? { skill, source: 'auto', project, ...session }
      : undefined;
  }
  const typed = extractTypedCommand(payload.prompt);
  return typed ? { skill: typed, source: 'typed', project, ...session } : undefined;
}

/**
 * Entry point for Claude Code hooks. Never throws: a broken hook must not
 * disturb the user's session, so every failure is logged and reported as a result.
 */
export class HookHandler {
  constructor(
    private readonly usage: UsageService,
    private readonly logger: Logger,
    /** Budget check for UserPromptSubmit; returns a line to show, if any. */
    private readonly budgetWarning?: () => Promise<string | undefined>,
  ) {}

  async handle(rawInput: string): Promise<HookResult> {
    let json: unknown;
    try {
      json = JSON.parse(rawInput);
    } catch {
      return this.fail('hook input is not JSON');
    }
    const parsed = hookPayloadSchema.safeParse(json);
    if (!parsed.success) return { kind: 'ignored', reason: 'unsupported hook event' };
    const [result, warning] = await Promise.all([
      this.record(parsed.data),
      parsed.data.hook_event_name === 'UserPromptSubmit' ? this.warning() : undefined,
    ]);
    return warning ? { ...result, warning } : result;
  }

  private async record(payload: HookPayload): Promise<HookResult> {
    try {
      const input = toRecordInput(payload);
      if (!input) return { kind: 'ignored', reason: 'not a skill use' };
      await this.usage.record(input);
      return { kind: 'recorded', skill: input.skill };
    } catch (error) {
      return this.fail(describeError(error));
    }
  }

  private async warning(): Promise<string | undefined> {
    if (!this.budgetWarning) return undefined;
    try {
      return await this.budgetWarning();
    } catch (error) {
      this.logger.error('budget check failed', { reason: describeError(error) });
      return undefined;
    }
  }

  private fail(reason: string): HookResult {
    this.logger.error('hook failed', { reason });
    return { kind: 'error', reason };
  }
}

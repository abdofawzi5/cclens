import type { RecordInput, UsageService } from '../../app/usage-service.js';
import { extractTypedCommand } from '../../core/domain/commands.js';
import { describeError } from '../../core/errors.js';
import type { Logger } from '../../core/ports/infrastructure.js';
import { hookPayloadSchema, type HookPayload } from './hook-payload.js';

export type HookResult =
  | { readonly kind: 'recorded'; readonly skill: string }
  | { readonly kind: 'ignored'; readonly reason: string }
  | { readonly kind: 'error'; readonly reason: string };

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
  ) {}

  async handle(rawInput: string): Promise<HookResult> {
    try {
      let json: unknown;
      try {
        json = JSON.parse(rawInput);
      } catch {
        return this.fail('hook input is not JSON');
      }
      const parsed = hookPayloadSchema.safeParse(json);
      if (!parsed.success) return { kind: 'ignored', reason: 'unsupported hook event' };
      const input = toRecordInput(parsed.data);
      if (!input) return { kind: 'ignored', reason: 'not a skill use' };
      await this.usage.record(input);
      return { kind: 'recorded', skill: input.skill };
    } catch (error) {
      return this.fail(describeError(error));
    }
  }

  private fail(reason: string): HookResult {
    this.logger.error('hook failed', { reason });
    return { kind: 'error', reason };
  }
}

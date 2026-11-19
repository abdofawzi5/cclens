import { z } from 'zod';

const base = {
  session_id: z.string().optional(),
  cwd: z.string().optional(),
};

/** The subset of Claude Code hook input cclens reads. Unknown fields are ignored. */
export const hookPayloadSchema = z.discriminatedUnion('hook_event_name', [
  z.object({
    ...base,
    hook_event_name: z.literal('PostToolUse'),
    tool_name: z.string(),
    tool_input: z.record(z.string(), z.unknown()).optional(),
  }),
  z.object({
    ...base,
    hook_event_name: z.literal('UserPromptSubmit'),
    prompt: z.string(),
  }),
]);

export type HookPayload = z.infer<typeof hookPayloadSchema>;

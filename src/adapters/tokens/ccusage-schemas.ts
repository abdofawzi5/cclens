import { z } from 'zod';

/** Shapes of `ccusage claude <report> --json` (verified against v20.0.51, see ADR 0002). */
const counts = {
  inputTokens: z.number(),
  outputTokens: z.number(),
  cacheCreationTokens: z.number(),
  cacheReadTokens: z.number(),
  totalCost: z.number(),
  modelsUsed: z.array(z.string()).default([]),
  modelBreakdowns: z
    .array(
      z.looseObject({
        modelName: z.string(),
        inputTokens: z.number(),
        outputTokens: z.number(),
        cacheCreationTokens: z.number(),
        cacheReadTokens: z.number(),
        cost: z.number(),
      }),
    )
    .default([]),
};

export const dailyReport = z.object({
  daily: z.array(z.looseObject({ date: z.string(), ...counts })),
});
export const weeklyReport = z.object({
  weekly: z.array(z.looseObject({ week: z.string(), ...counts })),
});
export const monthlyReport = z.object({
  monthly: z.array(z.looseObject({ month: z.string(), ...counts })),
});

export const sessionReport = z.object({
  sessions: z.array(
    z.looseObject({
      sessionId: z.string(),
      projectPath: z.string(),
      firstActivity: z.iso.datetime(),
      lastActivity: z.iso.datetime(),
      ...counts,
    }),
  ),
});

export const projectsReport = z.object({
  projects: z.record(z.string(), z.array(z.looseObject({ ...counts }))),
});

export const blocksReport = z.object({
  blocks: z.array(
    z.looseObject({
      startTime: z.iso.datetime(),
      endTime: z.iso.datetime(),
      isActive: z.boolean(),
      isGap: z.boolean().default(false),
      costUSD: z.number(),
      tokenCounts: z.object({
        inputTokens: z.number(),
        outputTokens: z.number(),
        cacheCreationInputTokens: z.number(),
        cacheReadInputTokens: z.number(),
      }),
      burnRate: z.looseObject({ tokensPerMinute: z.number() }).nullish(),
      projection: z.looseObject({ totalTokens: z.number() }).nullish(),
    }),
  ),
});

export type ModelBreakdownRow = CountsRow & { modelName: string; cost: number };

export type CountsRow = {
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
};

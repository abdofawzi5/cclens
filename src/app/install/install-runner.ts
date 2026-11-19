import { describeError } from '../../core/errors.js';
import type { InstallContext, InstallStep, StepOutcome } from '../../core/ports/install.js';

export interface StepReport extends StepOutcome {
  readonly id: string;
  readonly title: string;
}

export interface InstallReport {
  readonly ok: boolean;
  readonly steps: readonly StepReport[];
  /** Set when a step failed; earlier steps were undone. */
  readonly error?: string;
  readonly rolledBack: readonly string[];
}

/**
 * Runs install steps in order. If one fails, completed steps are undone in reverse,
 * so a failed `init` leaves the machine as it was.
 */
export class InstallRunner {
  async run(
    steps: readonly InstallStep[],
    options: { dryRun?: boolean } = {},
  ): Promise<InstallReport> {
    const ctx: InstallContext = { dryRun: options.dryRun ?? false, bag: new Map() };
    const done: InstallStep[] = [];
    const reports: StepReport[] = [];
    for (const step of steps) {
      try {
        const outcome = await step.execute(ctx);
        reports.push({ id: step.id, title: step.title, ...outcome });
        done.push(step);
      } catch (error) {
        const rolledBack = await this.rollback(done, ctx);
        return {
          ok: false,
          steps: reports,
          error: `${step.title}: ${describeError(error)}`,
          rolledBack,
        };
      }
    }
    return { ok: true, steps: reports, rolledBack: [] };
  }

  private async rollback(done: readonly InstallStep[], ctx: InstallContext): Promise<string[]> {
    const undone: string[] = [];
    for (const step of [...done].reverse()) {
      if (!step.undo) continue;
      try {
        await step.undo(ctx);
        undone.push(step.id);
      } catch {
        // Keep undoing the rest; the report lists what was rolled back.
      }
    }
    return undone;
  }
}

/** Shared state passed between install steps during one run. */
export interface InstallContext {
  readonly dryRun: boolean;
  /** Values steps hand to later steps or to their own undo (e.g. a settings backup). */
  readonly bag: Map<string, unknown>;
}

export interface StepOutcome {
  readonly status: 'done' | 'skipped';
  readonly message: string;
}

/** One reversible unit of `cclens init` (Command pattern). */
export interface InstallStep {
  readonly id: string;
  readonly title: string;
  execute(ctx: InstallContext): Promise<StepOutcome>;
  /** Reverts `execute`. Called in reverse order when a later step fails. */
  undo?(ctx: InstallContext): Promise<void>;
}

export type CheckStatus = 'ok' | 'warn' | 'fail';

export interface CheckResult {
  readonly id: string;
  readonly title: string;
  readonly status: CheckStatus;
  readonly message: string;
  readonly fix?: string;
}

/**
 * The file holding the command line that starts the cclens CLI. The Claude Code plugin's
 * hook script reads it, because GUI apps do not give hooks the shell's PATH (ADR 0006).
 */
export interface HookRunnerStore {
  readonly path: string;
  /** The saved command line, or undefined when none was saved. */
  read(): Promise<string | undefined>;
  write(command: string): Promise<void>;
}

/** One `cclens doctor` check. */
export interface HealthCheck {
  readonly id: string;
  readonly title: string;
  run(): Promise<Omit<CheckResult, 'id' | 'title'>>;
}

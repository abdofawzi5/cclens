/** Stable, machine-readable error codes. Part of the public API. */
export type ErrorCode =
  | 'CONFIG_INVALID'
  | 'CONFIG_IO'
  | 'VALIDATION'
  | 'ENGINE_FAILED'
  | 'ENGINE_UNKNOWN'
  | 'INTEGRATION_FAILED'
  | 'NOT_INSTALLED';

/** Base class for every error cclens throws on purpose. */
export class CclensError extends Error {
  readonly code: ErrorCode;

  constructor(code: ErrorCode, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = new.target.name;
    this.code = code;
  }
}

export class ConfigError extends CclensError {
  constructor(message: string, options?: { cause?: unknown; io?: boolean }) {
    super(options?.io ? 'CONFIG_IO' : 'CONFIG_INVALID', message, options);
  }
}

/** Input from outside (hook payloads, API responses, files) failed validation. */
export class ValidationError extends CclensError {
  readonly issues: readonly string[];

  constructor(message: string, issues: readonly string[] = [], options?: { cause?: unknown }) {
    super('VALIDATION', message, options);
    this.issues = issues;
  }
}

export class EngineError extends CclensError {
  readonly engineId: string;

  constructor(engineId: string, message: string, options?: { cause?: unknown; unknown?: boolean }) {
    super(options?.unknown ? 'ENGINE_UNKNOWN' : 'ENGINE_FAILED', message, options);
    this.engineId = engineId;
  }
}

/** A dependency we integrate with (ccusage, claude CLI, GitHub) failed or is missing. */
export class IntegrationError extends CclensError {
  readonly integration: string;

  constructor(integration: string, message: string, options?: { cause?: unknown }) {
    super('INTEGRATION_FAILED', message, options);
    this.integration = integration;
  }
}

export class NotInstalledError extends CclensError {
  constructor(message = 'cclens is not set up yet. Run `cclens init`.') {
    super('NOT_INSTALLED', message);
  }
}

export function isCclensError(e: unknown): e is CclensError {
  return e instanceof CclensError;
}

/** Best-effort human message for any thrown value. */
export function describeError(e: unknown): string {
  if (e instanceof Error) return e.message;
  return typeof e === 'string' ? e : JSON.stringify(e);
}

import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { Logger } from '../../core/ports/infrastructure.js';

/**
 * Appends JSON lines to a file. Synchronous and swallowing on purpose:
 * logging must never break the command (or the Claude Code hook) it serves.
 */
export class FileLogger implements Logger {
  constructor(
    private readonly file: string,
    private readonly verbose = false,
  ) {}

  debug(message: string, meta?: Record<string, unknown>): void {
    if (this.verbose) this.write('debug', message, meta);
  }

  warn(message: string, meta?: Record<string, unknown>): void {
    this.write('warn', message, meta);
  }

  error(message: string, meta?: Record<string, unknown>): void {
    this.write('error', message, meta);
  }

  private write(level: string, message: string, meta?: Record<string, unknown>): void {
    try {
      mkdirSync(dirname(this.file), { recursive: true });
      appendFileSync(
        this.file,
        `${JSON.stringify({ ts: new Date().toISOString(), level, message, ...meta })}\n`,
      );
    } catch {
      // Intentionally ignored: see class comment.
    }
  }
}

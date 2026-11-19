import { spawn } from 'node:child_process';
import { IntegrationError } from '../../core/errors.js';
import type { ProcessResult, ProcessRunner } from '../../core/ports/infrastructure.js';

/** Runs a program without a shell (no injection risk), with a timeout. */
export class NodeProcessRunner implements ProcessRunner {
  run(
    command: string,
    args: readonly string[],
    options: { timeoutMs?: number; input?: string; env?: Record<string, string> } = {},
  ): Promise<ProcessResult> {
    return new Promise((resolve, reject) => {
      const child = spawn(command, [...args], {
        env: { ...process.env, ...options.env },
        stdio: ['pipe', 'pipe', 'pipe'],
        timeout: options.timeoutMs ?? 60_000,
      });
      const out: Buffer[] = [];
      const err: Buffer[] = [];
      child.stdout.on('data', (b: Buffer) => out.push(b));
      child.stderr.on('data', (b: Buffer) => err.push(b));
      child.on('error', (cause) => {
        reject(
          new IntegrationError(command, `Could not run "${command}": ${cause.message}`, { cause }),
        );
      });
      child.on('close', (code, signal) => {
        resolve({
          exitCode: code ?? (signal ? 124 : 1),
          stdout: Buffer.concat(out).toString('utf8'),
          stderr: Buffer.concat(err).toString('utf8'),
        });
      });
      child.stdin.end(options.input ?? '');
    });
  }
}

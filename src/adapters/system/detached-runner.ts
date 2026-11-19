import { spawn } from 'node:child_process';
import type { BackgroundRunner } from '../../core/ports/infrastructure.js';

/**
 * Starts `node <cli.js> <args>` detached, with no stdio, and lets this process exit
 * at once. Failures are ignored: a background refresh is best effort.
 */
export class DetachedRunner implements BackgroundRunner {
  constructor(
    private readonly script: string | undefined = process.argv[1],
    private readonly node: string = process.execPath,
  ) {}

  start(args: readonly string[]): void {
    if (!this.script) return;
    try {
      const child = spawn(this.node, [this.script, ...args], {
        detached: true,
        stdio: 'ignore',
        env: { ...process.env, CCLENS_BACKGROUND: '1' },
      });
      child.on('error', () => undefined);
      child.unref();
    } catch {
      // Best effort.
    }
  }
}

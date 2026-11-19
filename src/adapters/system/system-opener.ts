import { IntegrationError } from '../../core/errors.js';
import type { Opener, ProcessRunner } from '../../core/ports/infrastructure.js';

/** Opens files with the OS default app: `open` (macOS), `xdg-open` (Linux), `start` (Windows). */
export class SystemOpener implements Opener {
  constructor(
    private readonly runner: ProcessRunner,
    private readonly platform: NodeJS.Platform = process.platform,
  ) {}

  async open(target: string): Promise<void> {
    const [command, args] =
      this.platform === 'darwin'
        ? ['open', [target]]
        : this.platform === 'win32'
          ? ['cmd', ['/c', 'start', '', target]]
          : ['xdg-open', [target]];
    const result = await this.runner.run(command, args, { timeoutMs: 10_000 });
    if (result.exitCode !== 0) {
      throw new IntegrationError(
        'opener',
        `Could not open ${target}: ${result.stderr.trim() || `${command} exited ${result.exitCode}`}`,
      );
    }
  }
}

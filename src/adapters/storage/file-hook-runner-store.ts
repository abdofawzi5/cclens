import { readFile } from 'node:fs/promises';
import type { HookRunnerStore } from '../../core/ports/install.js';
import { writeFileAtomic } from './atomic-write.js';

/** Keeps the cclens command line in a one-line text file the plugin's shell script can read. */
export class FileHookRunnerStore implements HookRunnerStore {
  constructor(readonly path: string) {}

  async read(): Promise<string | undefined> {
    try {
      const text = (await readFile(this.path, 'utf8')).trim();
      return text || undefined;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
      throw error;
    }
  }

  async write(command: string): Promise<void> {
    await writeFileAtomic(this.path, `${command}\n`);
  }
}

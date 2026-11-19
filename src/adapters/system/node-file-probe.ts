import { access } from 'node:fs/promises';
import type { FileProbe } from '../../core/ports/infrastructure.js';

export class NodeFileProbe implements FileProbe {
  async exists(path: string): Promise<boolean> {
    try {
      await access(path);
      return true;
    } catch {
      return false;
    }
  }
}

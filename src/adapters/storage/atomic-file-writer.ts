import type { FileWriter } from '../../core/ports/infrastructure.js';
import { writeFileAtomic } from './atomic-write.js';

/** `FileWriter` on top of the temp-file-then-rename helper used for settings. */
export class AtomicFileWriter implements FileWriter {
  write(path: string, data: string): Promise<void> {
    return writeFileAtomic(path, data);
  }
}

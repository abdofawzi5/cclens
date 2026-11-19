import type { SessionOverhead } from '../domain/overhead.js';

/** What each session sent before its first prompt, from transcripts. */
export interface ContextOverheadSource {
  read(since?: Date): Promise<readonly SessionOverhead[]>;
}

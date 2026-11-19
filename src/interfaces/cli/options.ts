import type { Command } from 'commander';
import type { OutputFormat } from '../render/renderer.js';

/** Reads the global `--json` flag. */
export function formatOf(program: Command): OutputFormat {
  return program.opts<{ json?: boolean }>().json ? 'json' : 'table';
}

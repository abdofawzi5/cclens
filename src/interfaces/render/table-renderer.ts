import Table from 'cli-table3';
import pc from 'picocolors';
import type { Renderer } from './renderer.js';

export interface Column<T> {
  readonly header: string;
  readonly value: (row: T) => string | number;
  readonly align?: 'left' | 'right';
}

export interface TableOptions<T> {
  readonly title?: string;
  readonly footer?: (rows: readonly T[]) => string;
}

/** Generic table over rows of T. Commands describe columns; this class draws them. */
export class TableRenderer<T> implements Renderer {
  constructor(
    private readonly columns: readonly Column<T>[],
    private readonly options: TableOptions<T> = {},
  ) {}

  render(data: unknown): string {
    const rows = data as readonly T[];
    if (rows.length === 0) return pc.dim('Nothing to show.');
    const table = new Table({
      head: this.columns.map((c) => pc.bold(c.header)),
      colAligns: this.columns.map((c) => c.align ?? 'left'),
      style: { head: [], border: ['grey'] },
      // Compact: no separator line between body rows.
      chars: { mid: '', 'left-mid': '', 'mid-mid': '', 'right-mid': '' },
    });
    for (const row of rows) table.push(this.columns.map((c) => String(c.value(row))));
    const parts = [this.options.title ? pc.bold(this.options.title) : '', table.toString()];
    if (this.options.footer) parts.push(this.options.footer(rows));
    return parts.filter(Boolean).join('\n');
  }
}

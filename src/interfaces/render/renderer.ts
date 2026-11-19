/** Turns command output into text. One implementation per output format. */
export interface Renderer {
  render(data: unknown): string;
}

export type OutputFormat = 'table' | 'json';

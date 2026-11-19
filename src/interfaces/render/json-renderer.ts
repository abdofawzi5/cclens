import type { Renderer } from './renderer.js';

/** Stable machine-readable output; Dates become ISO strings and Maps become objects. */
export class JsonRenderer implements Renderer {
  render(data: unknown): string {
    return JSON.stringify(
      data,
      (_key, value: unknown): unknown =>
        value instanceof Map ? (Object.fromEntries(value) as unknown) : value,
      2,
    );
  }
}

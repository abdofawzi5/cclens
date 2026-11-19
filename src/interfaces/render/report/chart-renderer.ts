/** A chart described independently of the library that draws it. One series, one axis. */
export interface ChartSpec {
  readonly id: string;
  readonly kind: 'bar' | 'hbar';
  /** Accessible name; the visible title sits in the page's own heading. */
  readonly title: string;
  readonly labels: readonly string[];
  readonly values: readonly number[];
  readonly unit: 'usd' | 'tokens';
}

/**
 * Draws charts inside a self-contained HTML file. Swapping chart libraries means
 * writing another implementation; the report page does not change.
 */
export interface ChartRenderer {
  /** `<script>` tags with the library source, inlined (no network requests). */
  head(): string;
  /** The element the chart is drawn into. */
  placeholder(spec: ChartSpec): string;
  /** A `<script>` that draws every chart; runs after the placeholders exist. */
  script(specs: readonly ChartSpec[]): string;
}

/** Stops `</script>` (or `<!--`) inside inlined code or data from ending the script element. */
export function safeForScript(code: string): string {
  return code.replace(/<\/(script)/gi, '<\\/$1').replace(/<!--/g, '<\\!--');
}

/** JSON that can sit inside a `<script>`: every `<` becomes `\u003c`. */
export function jsonForScript(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

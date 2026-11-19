#!/usr/bin/env node
declare const __CCLENS_VERSION__: string;
const version = typeof __CCLENS_VERSION__ === 'string' ? __CCLENS_VERSION__ : '0.0.0-dev';

/*
 * Modules load lazily: `cclens statusline` runs on every Claude Code status-line
 * redraw, so it skips commander, zod and the container (see statusline.ts).
 */

async function main(): Promise<void> {
  if (process.argv[2] === 'statusline' && !process.argv.includes('--help')) {
    const { runStatusline } = await import('../statusline/statusline.js');
    await runStatusline(process.argv.slice(3));
    return;
  }
  const [{ createContainer }, { buildProgram }] = await Promise.all([
    import('../../composition-root.js'),
    import('./program.js'),
  ]);
  const container = createContainer({ verbose: process.env['CCLENS_DEBUG'] === '1', version });
  await buildProgram(container, version).parseAsync(process.argv);
}

main().catch(async (error: unknown) => {
  const [{ default: pc }, { describeError, isCclensError }] = await Promise.all([
    import('picocolors'),
    import('../../core/errors.js'),
  ]);
  const code = isCclensError(error) ? ` [${error.code}]` : '';
  process.stderr.write(`${pc.red('cclens:')} ${describeError(error)}${code}\n`);
  process.exitCode = 1;
});

#!/usr/bin/env node
import pc from 'picocolors';
import { createContainer } from '../../composition-root.js';
import { describeError, isCclensError } from '../../core/errors.js';
import { buildProgram } from './program.js';

declare const __CCLENS_VERSION__: string;
const version = typeof __CCLENS_VERSION__ === 'string' ? __CCLENS_VERSION__ : '0.0.0-dev';

async function main(): Promise<void> {
  const container = createContainer({ verbose: process.env['CCLENS_DEBUG'] === '1' });
  await buildProgram(container, version).parseAsync(process.argv);
}

main().catch((error: unknown) => {
  const code = isCclensError(error) ? ` [${error.code}]` : '';
  process.stderr.write(`${pc.red('cclens:')} ${describeError(error)}${code}\n`);
  process.exitCode = 1;
});

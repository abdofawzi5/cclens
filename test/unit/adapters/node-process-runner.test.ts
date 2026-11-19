import { describe, expect, it } from 'vitest';
import { NodeProcessRunner } from '../../../src/adapters/system/node-process-runner.js';
import { IntegrationError } from '../../../src/core/errors.js';

describe('NodeProcessRunner', () => {
  const runner = new NodeProcessRunner();

  it('captures stdout, stderr, exit code and stdin', async () => {
    const script =
      'process.stdin.on("data",d=>process.stdout.write(d));console.error("e");process.exitCode=3';
    const result = await runner.run(process.execPath, ['-e', script], { input: 'hi' });
    expect(result).toEqual({ exitCode: 3, stdout: 'hi', stderr: 'e\n' });
  });

  it('wraps a missing binary in IntegrationError', async () => {
    await expect(runner.run('cclens-definitely-missing-binary', [])).rejects.toBeInstanceOf(
      IntegrationError,
    );
  });
});

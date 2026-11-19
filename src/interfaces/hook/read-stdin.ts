/** Reads all of stdin, giving up after `timeoutMs` so a hook can never hang Claude Code. */
export function readStdin(stream: NodeJS.ReadableStream, timeoutMs = 2_000): Promise<string> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    const done = (): void => {
      clearTimeout(timer);
      resolve(Buffer.concat(chunks).toString('utf8'));
    };
    const timer = setTimeout(done, timeoutMs);
    stream.on('data', (c: Buffer | string) =>
      chunks.push(typeof c === 'string' ? Buffer.from(c) : c),
    );
    stream.on('end', done);
    stream.on('error', done);
  });
}

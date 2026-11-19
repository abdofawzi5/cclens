import type { ProcessRunner, SecretResolver } from '../../core/ports/infrastructure.js';

const REF = /\$\{env:([A-Z_][A-Z0-9_]*)\}/g;

/**
 * Resolves `${env:NAME}` from the environment. The GitHub token additionally falls
 * back to the GitHub CLI (`gh auth token`) so signed-in users get the higher rate limit
 * without putting a token anywhere. Lookups are memoized.
 */
export class EnvSecretResolver implements SecretResolver {
  private ghToken?: Promise<string | undefined>;

  constructor(
    private readonly env: NodeJS.ProcessEnv,
    private readonly runner?: ProcessRunner,
  ) {}

  resolve(text: string): string | undefined {
    const missing: string[] = [];
    const out = text.replace(REF, (_match, name: string) => {
      const value = this.env[name];
      if (!value) missing.push(name);
      return value ?? '';
    });
    return missing.length > 0 ? undefined : out;
  }

  githubToken(ref?: string): Promise<string | undefined> {
    const fromRef = ref ? this.resolve(ref) : undefined;
    if (fromRef) return Promise.resolve(fromRef);
    const fromEnv = this.env['GITHUB_TOKEN'] ?? this.env['GH_TOKEN'];
    if (fromEnv) return Promise.resolve(fromEnv);
    this.ghToken ??= this.fromGhCli();
    return this.ghToken;
  }

  private async fromGhCli(): Promise<string | undefined> {
    if (!this.runner) return undefined;
    try {
      const r = await this.runner.run('gh', ['auth', 'token'], { timeoutMs: 3_000 });
      const token = r.stdout.trim();
      return r.exitCode === 0 && token ? token : undefined;
    } catch {
      return undefined;
    }
  }
}

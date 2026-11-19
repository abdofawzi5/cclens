import { describe, expect, it } from 'vitest';
import { ConfigService } from '../../../src/app/config-service.js';
import { EngineError } from '../../../src/core/errors.js';
import { InMemoryConfigStore } from '../../support/in-memory-config-store.js';

describe('ConfigService', () => {
  it('disables and re-enables an engine', async () => {
    const store = new InMemoryConfigStore();
    const service = new ConfigService(store);
    expect((await service.setEngineEnabled('skillssh', false)).enabled).toBe(false);
    expect(store.saved?.engines.find((e) => e.id === 'skillssh')?.enabled).toBe(false);
    expect((await service.setEngineEnabled('skillssh', true)).enabled).toBe(true);
    expect((await service.engines()).every((e) => e.enabled)).toBe(true);
  });

  it('rejects unknown engines with the list of known ones', async () => {
    const service = new ConfigService(new InMemoryConfigStore());
    const error = await service.setEngineEnabled('nope', true).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(EngineError);
    expect((error as EngineError).code).toBe('ENGINE_UNKNOWN');
    expect((error as EngineError).message).toContain('github, skillsmp, skillssh');
  });
});

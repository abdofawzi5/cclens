import { describe, expect, it } from 'vitest';
import {
  CclensError,
  ConfigError,
  describeError,
  EngineError,
  IntegrationError,
  isCclensError,
  NotInstalledError,
  ValidationError,
} from '../../../src/core/errors.js';

describe('error hierarchy', () => {
  it('assigns stable codes and names', () => {
    expect(new ConfigError('x').code).toBe('CONFIG_INVALID');
    expect(new ConfigError('x', { io: true }).code).toBe('CONFIG_IO');
    expect(new ValidationError('x', ['a']).issues).toEqual(['a']);
    expect(new EngineError('github', 'x').code).toBe('ENGINE_FAILED');
    expect(new EngineError('nope', 'x', { unknown: true }).code).toBe('ENGINE_UNKNOWN');
    expect(new IntegrationError('ccusage', 'x').integration).toBe('ccusage');
    const notInstalled = new NotInstalledError();
    expect(notInstalled.code).toBe('NOT_INSTALLED');
    expect(notInstalled.name).toBe('NotInstalledError');
    expect(notInstalled).toBeInstanceOf(CclensError);
  });

  it('keeps the cause', () => {
    const cause = new Error('root');
    expect(new ConfigError('x', { cause }).cause).toBe(cause);
  });

  it('identifies and describes errors', () => {
    expect(isCclensError(new ConfigError('x'))).toBe(true);
    expect(isCclensError(new Error('x'))).toBe(false);
    expect(describeError(new Error('boom'))).toBe('boom');
    expect(describeError('plain')).toBe('plain');
    expect(describeError({ a: 1 })).toBe('{"a":1}');
  });
});

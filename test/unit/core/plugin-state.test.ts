import { describe, expect, it } from 'vitest';
import { disabledPluginNames } from '../../../src/core/domain/plugin-state.js';

const none = { enabled: [], disabled: [] };

describe('disabledPluginNames', () => {
  it('returns names of plugins set to false', () => {
    expect(
      disabledPluginNames({ enabled: ['cclens@cclens'], disabled: ['marketing@synced'] }, none),
    ).toEqual(new Set(['marketing']));
  });

  it('lets project settings override user settings for the same key', () => {
    expect(
      disabledPluginNames(
        { enabled: [], disabled: ['figma@synced'] },
        { enabled: ['figma@synced'], disabled: [] },
      ),
    ).toEqual(new Set());
    expect(
      disabledPluginNames(
        { enabled: ['figma@synced'], disabled: [] },
        { enabled: [], disabled: ['figma@synced'] },
      ),
    ).toEqual(new Set(['figma']));
  });

  it('keeps a name counted while another of its keys is enabled', () => {
    expect(
      disabledPluginNames({ enabled: ['design@official'], disabled: ['design@synced'] }, none),
    ).toEqual(new Set());
  });

  it('returns nothing when nothing is turned off', () => {
    expect(disabledPluginNames(none, none)).toEqual(new Set());
  });
});

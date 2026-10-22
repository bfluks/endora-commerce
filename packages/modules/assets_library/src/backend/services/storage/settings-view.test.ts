import { describe, expect, it } from 'vitest';
import type { EntityManager } from '@mikro-orm/postgresql';
import { Setting, SettingValue } from '@endora-commerce/platform/kernel';

import { createSettingsView } from './settings-view.js';

// specs/156-asset-stable-url/ T032 — the retention a sweep and every reported
// purge date read: at least one day (owner ruling P3).

function viewOver(value: unknown, missing = false) {
  const em = {
    findOne: async (entity: unknown) => {
      if (entity === Setting) return missing ? null : { defaultValue: 30, globalValue: undefined };
      if (entity === SettingValue) return { value };
      throw new Error('unexpected entity');
    },
  } as unknown as EntityManager;
  return createSettingsView(() => em);
}

describe('softDeleteRetentionDays', () => {
  it.each([
    [0, 1],
    [0.25, 1],
    [7.5, 7.5],
    [14, 14],
    [-1, 30],
    [Infinity, 30],
    ['x', 30],
    // Block review F: an empty or non-numeric value applies as 30, never as 0.
    ['', 30],
    ['   ', 30],
    [null, 30],
    [true, 30],
    [[], 30],
    [{}, 30],
    ['7', 7],
  ] as const)('answers %s as %s', async (value, days) => {
    expect(await viewOver(value as unknown).softDeleteRetentionDays()).toBe(days);
  });

  it('answers 30 for a missing setting', async () => {
    expect(await viewOver(undefined, true).softDeleteRetentionDays()).toBe(30);
  });
});

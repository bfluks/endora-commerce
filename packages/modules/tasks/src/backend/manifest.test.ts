import { describe, expect, it } from 'vitest';
import { manifest } from '../manifest.js';

describe('tasks manifest', () => {
  it('is an operator-toggleable module, on by default', () => {
    expect(manifest.id).toBe('tasks');
    expect(manifest.activation).toEqual({ settingCode: 'tasks.enabled', default: true });
  });

  it('declares its activation control as a boolean setting of its own group', () => {
    const control = manifest.settings?.settings.find((s) => s.code === 'tasks.enabled');
    expect(control).toMatchObject({ groupCode: 'tasks', valueType: 'boolean', defaultValue: true });
  });
});

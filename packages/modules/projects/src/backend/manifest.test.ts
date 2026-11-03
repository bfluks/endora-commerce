import { describe, expect, it } from 'vitest';
import { manifest } from '../manifest.js';

describe('projects manifest', () => {
  it('is an operator-toggleable module, on by default', () => {
    expect(manifest.id).toBe('projects');
    expect(manifest.activation).toEqual({ settingCode: 'projects.enabled', default: true });
  });

  it('declares its activation control as a boolean setting of its own group', () => {
    const control = manifest.settings?.settings.find((s) => s.code === 'projects.enabled');
    expect(control).toMatchObject({ groupCode: 'projects', valueType: 'boolean', defaultValue: true });
  });
});

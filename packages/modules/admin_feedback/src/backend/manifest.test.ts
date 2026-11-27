import { describe, expect, it } from 'vitest';
import {
  ADMIN_FEEDBACK_DEFAULT_RELAY_URL,
  ADMIN_FEEDBACK_ERROR_CODES,
  ADMIN_FEEDBACK_SETTING_CODES,
} from '@endora-commerce/contracts';
import { manifest } from '../manifest.js';
import en from '../../i18n/en.json' with { type: 'json' };
import pl from '../../i18n/pl.json' with { type: 'json' };

describe('admin_feedback manifest', () => {
  it('is an operator-toggleable module, on by default', () => {
    expect(manifest.id).toBe('admin_feedback');
    expect(manifest.activation).toEqual({
      settingCode: ADMIN_FEEDBACK_SETTING_CODES.MODULE_ENABLED,
      default: true,
    });
  });

  it('declares its two settings in its own group, with the default relay address', () => {
    const settings = manifest.settings?.settings ?? [];
    expect(settings.find((s) => s.code === ADMIN_FEEDBACK_SETTING_CODES.MODULE_ENABLED)).toMatchObject({
      groupCode: 'admin_feedback',
      valueType: 'boolean',
      defaultValue: true,
    });
    expect(settings.find((s) => s.code === ADMIN_FEEDBACK_SETTING_CODES.RELAY_URL)).toMatchObject({
      groupCode: 'admin_feedback',
      valueType: 'string',
      defaultValue: ADMIN_FEEDBACK_DEFAULT_RELAY_URL,
    });
  });

  it('declares the error codes its route answers with, and both bundles carry their sentences', () => {
    const declared = (manifest.errorCodes ?? []).map((entry) => entry.code).sort();
    expect(declared).toEqual(Object.values(ADMIN_FEEDBACK_ERROR_CODES).sort());
    for (const code of declared) {
      expect((en as Record<string, string>)[`errors.${code}`]).toBeTruthy();
      expect((pl as Record<string, string>)[`errors.${code}`]).toBeTruthy();
    }
  });

  it('labels every setting and its group in both languages', () => {
    const keys = [
      'settingGroups.admin_feedback.name',
      ...(manifest.settings?.settings ?? []).flatMap((s) => [
        `settingLabels.${s.code}.name`,
        `settingLabels.${s.code}.description`,
      ]),
    ];
    for (const key of keys) {
      expect((en as Record<string, string>)[key], `en ${key}`).toBeTruthy();
      expect((pl as Record<string, string>)[key], `pl ${key}`).toBeTruthy();
    }
  });
});

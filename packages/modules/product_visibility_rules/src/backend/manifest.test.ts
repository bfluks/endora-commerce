import { describe, expect, it } from 'vitest';
import { PRODUCT_VISIBILITY_PERMISSIONS, PRODUCT_VISIBILITY_SETTING_CODES } from '@endora-commerce/contracts';
import { manifest } from '../manifest.js';
import en from '../../i18n/en.json' with { type: 'json' };
import pl from '../../i18n/pl.json' with { type: 'json' };

/** What `product_visibility_rules` declares. */
describe('product_visibility_rules manifest', () => {
  const settings = manifest.settings?.settings ?? [];

  it('is operator-toggleable and shipped off (R-3, OQ-C A)', () => {
    expect(manifest.id).toBe('product_visibility_rules');
    expect(manifest.activation).toEqual({ settingCode: PRODUCT_VISIBILITY_SETTING_CODES.MODULE_ENABLED, default: false });
    expect(settings.find((s) => s.code === PRODUCT_VISIBILITY_SETTING_CODES.MODULE_ENABLED)).toMatchObject({
      valueType: 'boolean',
      defaultValue: false,
    });
  });

  it('depends on the owners of what it reads (R-1)', () => {
    expect([...(manifest.dependencies ?? [])].sort()).toEqual(
      ['admin_roles', 'audit_logs', 'catalog', 'currencies', 'price_lists', 'sales_channels'].sort(),
    );
  });

  it('declares read and manage; manage requires read', () => {
    expect(manifest.permissions?.map((p) => p.code)).toEqual([
      PRODUCT_VISIBILITY_PERMISSIONS.READ,
      PRODUCT_VISIBILITY_PERMISSIONS.MANAGE,
    ]);
    expect(manifest.permissions?.find((p) => p.code === PRODUCT_VISIBILITY_PERMISSIONS.MANAGE)?.requires).toEqual([
      PRODUCT_VISIBILITY_PERMISSIONS.READ,
    ]);
  });

  it('declares the error codes it raises, each with a sentence in both languages', () => {
    const codes = (manifest.errorCodes ?? []).map((e) => e.code).sort();
    expect(codes).toEqual([
      'CHANNEL_ALREADY_GOVERNED',
      'DESIGNATION_INVALID',
      'PRODUCT_RULE_ATTACHED',
      'ROLE_NOT_MAPPABLE',
      'VISIBILITY_CATEGORY_IN_USE',
      'WEBSITE_RULE_PREVIEW_LIMIT',
      'WEBSITE_RULE_PREVIEW_REQUIRED',
      'WEBSITE_RULE_PREVIEW_STALE',
    ]);
    for (const code of codes) {
      expect((en as Record<string, string>)[`errors.${code}`], `en ${code}`).toBeTruthy();
      expect((pl as Record<string, string>)[`errors.${code}`], `pl ${code}`).toBeTruthy();
    }
  });

  it('labels every permission and setting in both shipped languages', () => {
    const keys = [
      ...(manifest.permissions ?? []).map((p) => `adminRoles.permission.${p.code}`),
      ...settings.flatMap((s) => [`settingLabels.${s.code}.name`, `settingLabels.${s.code}.description`]),
      'module.name',
      'module.description',
    ];
    for (const key of keys) {
      expect((en as Record<string, string>)[key], `en ${key}`).toBeTruthy();
      expect((pl as Record<string, string>)[key], `pl ${key}`).toBeTruthy();
    }
    expect(Object.keys(pl).sort()).toEqual(Object.keys(en).sort());
  });
});

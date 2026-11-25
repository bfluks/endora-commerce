import {
  PRODUCT_VISIBILITY_SETTING_CODES,
  defineModuleManifest,
  defineModuleSettingsManifest,
} from '@endora-commerce/contracts';

/**
 * Product visibility rules (`specs/193-product-visibility-rules/`).
 *
 * Narrows which products an administrator sees by the role's visibility category — a
 * product qualifies by its catalogue price in one or more currencies — and lets a sales
 * channel's product membership follow a named product rule (the website rule). Owns the
 * categories, the role mappings, the per-currency catalogue-price designations, the
 * product rules and their attachments, and the derived catalogue-price flags (research R-1).
 *
 * Shipped **off** (R-3, OQ-C A): an installation that never switches it on behaves exactly
 * as before. Switching it off lifts every restriction and keeps every row; switching it
 * back on restores them (FR-073).
 */
const C = PRODUCT_VISIBILITY_SETTING_CODES;

export const productVisibilityRulesSettingsManifest = defineModuleSettingsManifest({
  moduleCode: 'product_visibility_rules',
  groups: [{ code: 'product_visibility_rules', name: 'Product visibility rules' }],
  settings: [
    {
      // Constitution XVII — the operator's activation control. Platform-wide.
      code: C.MODULE_ENABLED,
      name: 'Product visibility rules module enabled',
      description:
        'Switches product visibility rules on or off for the whole platform. On: mapped roles see only the products of their visibility category, unmapped roles that handle quote requests see no products until mapped, and website rules govern their sales channels. Off: every restriction is lifted at once; the configuration is kept and applies again when the module is switched back on.',
      groupCode: 'product_visibility_rules',
      valueType: 'boolean',
      defaultValue: false,
    },
  ],
});

export const manifest = defineModuleManifest({
  id: 'product_visibility_rules',
  name: 'Product visibility rules',
  description:
    'Limits which products an administrator role sees by the products’ catalogue prices, and lets a sales channel’s products follow a configurable rule.',
  version: '1.0.0',
  // Research R-1 — the owners of what this module reads: products and variants
  // (`catalog`), catalogue prices (`price_lists`), roles and their permissions
  // (`admin_roles`), currencies (`currencies`), channel membership (`sales_channels`),
  // and the audit trail of its configuration (`audit_logs`). Every one of them is
  // `nonDeactivatable`, so no edge makes an activation control a dead switch.
  dependencies: ['catalog', 'price_lists', 'admin_roles', 'currencies', 'sales_channels', 'audit_logs'],
  settings: productVisibilityRulesSettingsManifest,
  // R-3, OQ-C A — operator-toggleable, shipped off.
  activation: { settingCode: C.MODULE_ENABLED, default: false },
  // The two permission codes, the palette actions and the error codes land with the
  // configuration routes that enforce and raise them (spec 193 Phase 3): the permission
  // inventory refuses a grantable code no gate enforces.
  i18n: { bundlesDir: 'i18n' },
  docs: { dir: 'docs' },
});

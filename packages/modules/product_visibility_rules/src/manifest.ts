import {
  PRODUCT_VISIBILITY_ERROR_CODES,
  PRODUCT_VISIBILITY_PERMISSIONS,
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
const P = PRODUCT_VISIBILITY_PERMISSIONS;
const E = PRODUCT_VISIBILITY_ERROR_CODES;

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
  // FR-076 (M10) and TM-13: `/platform/modules` shows this beside the activation switch, so it
  // says what switching it on and off does (pinned by
  // `backend/test/unit/product_visibility_rules/activation-texts.test.ts`).
  description:
    'Limits which products an administrator role sees by the products’ catalogue prices, and lets a sales channel’s products follow a configurable rule. Switching it on applies at once: a role that handles quote requests and is not mapped sees no products until it is mapped. Switching it off lifts every product restriction: every restricted role sees all products while it is off. The configuration is kept.',
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
  permissions: [
    { code: P.READ, label: 'View product visibility rules' },
    {
      code: P.MANAGE,
      label: 'Manage product visibility rules',
      requires: [P.READ],
    },
  ],
  // Principle XVI — the configuration screen under ⌘K. Its API entry is declared, so
  // `check:action-route-permissions` compares the gate of the route the screen opens on.
  actions: [
    {
      id: 'open-product-visibility',
      labelKey: 'actions.openProductVisibility.label',
      descriptionKey: 'actions.openProductVisibility.description',
      icon: 'ShieldCheck',
      targetRoute: '/product-visibility',
      entryApiRoute: '/api/v1/admin/product-visibility/overview',
      requiredPermission: P.READ,
      keywords: ['visibility', 'catalogue', 'price', 'roles', 'categories'],
      keywordsKey: 'actions.openProductVisibility.keywords',
      weight: 420,
    },
    {
      // US4 — the website rules screen, a static route of its own (palette coverage).
      id: 'open-website-rules',
      labelKey: 'actions.openWebsiteRules.label',
      descriptionKey: 'actions.openWebsiteRules.description',
      icon: 'Store',
      targetRoute: '/product-visibility/website-rules',
      entryApiRoute: '/api/v1/admin/product-visibility/overview',
      requiredPermission: P.READ,
      keywords: ['website', 'storefront', 'channel', 'rule', 'membership'],
      keywordsKey: 'actions.openWebsiteRules.keywords',
      weight: 410,
    },
  ],
  // Routes the codes' sentences to this package's own bundle; each joins the platform's
  // `ERROR_CODES` with its first raise site (events-and-errors.md §2).
  errorCodes: [
    { code: E.VISIBILITY_CATEGORY_IN_USE },
    { code: E.ROLE_NOT_MAPPABLE },
    { code: E.DESIGNATION_INVALID },
    // Phase 6 — the website rule (stream B).
    { code: E.PRODUCT_RULE_ATTACHED },
    { code: E.WEBSITE_RULE_PREVIEW_REQUIRED },
    { code: E.WEBSITE_RULE_PREVIEW_LIMIT },
    { code: E.WEBSITE_RULE_PREVIEW_STALE },
    { code: E.CHANNEL_ALREADY_GOVERNED },
  ],
  i18n: { bundlesDir: 'i18n' },
  docs: { dir: 'docs' },
});

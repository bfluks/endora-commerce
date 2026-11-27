import { describe, expect, expectTypeOf, it } from 'vitest';
import {
  PRODUCT_RULE_MAX_CONDITIONS,
  PRODUCT_VISIBILITY_ERROR_CODES,
  PRODUCT_VISIBILITY_PERMISSIONS,
  PRODUCT_VISIBILITY_SELF_LIFTING_PERMISSIONS,
  PRODUCT_VISIBILITY_SETTING_CODES,
  ProductRuleDefinitionSchema,
  productVisibilityCategoryCreateBodySchema,
  productVisibilityCategoryUpdateBodySchema,
  productVisibilityDesignationBodySchema,
  productVisibilityOverviewResponseSchema,
  productVisibilityRoleMappingBodySchema,
  productVisibilityRoleEffectSchema,
  visibilityThresholdSchema,
  websiteRulePreviewCreateBodySchema,
  type AdminProductVisibilityScope,
  type VisibilityPredicate,
} from './product-visibility.js';
import { designationStatusSchema } from './price-lists.js';

const UUID = '7b0c4c3e-1d1a-4a43-9f39-4b5e3c1d2a10';
const UUID_2 = '1f9f6b52-5a54-4d55-8a11-6f0b6c9d1e22';

const attr = (key: string, value = true) => ({ kind: 'attribute_boolean' as const, attributeKey: key, value });

describe('visibility threshold (FR-011)', () => {
  it('accepts exactly gt_zero and gte_zero', () => {
    expect(visibilityThresholdSchema.options).toEqual(['gt_zero', 'gte_zero']);
    expect(visibilityThresholdSchema.safeParse('gt').success).toBe(false);
    expect(visibilityThresholdSchema.safeParse(null).success).toBe(false);
  });
});

describe('category bodies (FR-010 – FR-012)', () => {
  it('requires a name and at least one condition', () => {
    expect(productVisibilityCategoryCreateBodySchema.safeParse({ name: 'Wholesale', conditions: [] }).success).toBe(false);
    expect(
      productVisibilityCategoryCreateBodySchema.safeParse({
        name: 'Wholesale',
        conditions: [{ currencyCode: 'PLN', threshold: 'gt_zero' }],
      }).success,
    ).toBe(true);
    expect(
      productVisibilityCategoryCreateBodySchema.safeParse({
        name: '   ',
        conditions: [{ currencyCode: 'PLN', threshold: 'gt_zero' }],
      }).success,
    ).toBe(false);
  });

  it('refuses a malformed currency code and an over-long name', () => {
    expect(
      productVisibilityCategoryCreateBodySchema.safeParse({
        name: 'A',
        conditions: [{ currencyCode: 'pln', threshold: 'gt_zero' }],
      }).success,
    ).toBe(false);
    expect(
      productVisibilityCategoryCreateBodySchema.safeParse({
        name: 'x'.repeat(121),
        conditions: [{ currencyCode: 'PLN', threshold: 'gt_zero' }],
      }).success,
    ).toBe(false);
  });

  it('refuses the same currency and threshold twice', () => {
    expect(
      productVisibilityCategoryCreateBodySchema.safeParse({
        name: 'A',
        conditions: [
          { currencyCode: 'PLN', threshold: 'gt_zero' },
          { currencyCode: 'PLN', threshold: 'gt_zero' },
        ],
      }).success,
    ).toBe(false);
  });

  it('update is partial but never empties the conditions', () => {
    expect(productVisibilityCategoryUpdateBodySchema.safeParse({ name: 'B' }).success).toBe(true);
    expect(productVisibilityCategoryUpdateBodySchema.safeParse({ conditions: [] }).success).toBe(false);
  });
});

describe('role mapping body (FR-020, FR-025 — I-2)', () => {
  it('takes a category, unrestricted or null', () => {
    expect(productVisibilityRoleMappingBodySchema.safeParse({ target: { kind: 'category', categoryId: UUID } }).success).toBe(true);
    expect(productVisibilityRoleMappingBodySchema.safeParse({ target: { kind: 'unrestricted' } }).success).toBe(true);
    expect(productVisibilityRoleMappingBodySchema.safeParse({ target: null }).success).toBe(true);
    expect(productVisibilityRoleMappingBodySchema.safeParse({}).success).toBe(false);
    expect(productVisibilityRoleMappingBodySchema.safeParse({ target: { kind: 'category' } }).success).toBe(false);
    expect(productVisibilityRoleMappingBodySchema.safeParse({ target: { kind: 'system' } }).success).toBe(false);
  });
});

describe('designation body (FR-001)', () => {
  it('names a book and a channel', () => {
    expect(productVisibilityDesignationBodySchema.safeParse({ priceListId: UUID, salesChannelId: UUID_2 }).success).toBe(true);
    expect(productVisibilityDesignationBodySchema.safeParse({ priceListId: UUID }).success).toBe(false);
  });
});

describe('product rule definition (contracts/ports.md §4, TM-11)', () => {
  it('accepts a flat rule and a rule with one level of groups', () => {
    expect(ProductRuleDefinitionSchema.safeParse({ match: 'all', conditions: [attr('wholesale')] }).success).toBe(true);
    expect(
      ProductRuleDefinitionSchema.safeParse({
        match: 'any',
        conditions: [
          { kind: 'catalogue_price', currencyCode: 'EUR', threshold: 'gte_zero' },
          { kind: 'group', match: 'all', conditions: [attr('a'), { kind: 'attribute_choice', attributeKey: 'brand', optionKeys: ['x'] }] },
        ],
      }).success,
    ).toBe(true);
  });

  it('refuses a group nested in a group', () => {
    expect(
      ProductRuleDefinitionSchema.safeParse({
        match: 'all',
        conditions: [
          { kind: 'group', match: 'all', conditions: [{ kind: 'group', match: 'any', conditions: [attr('a')] }] },
        ],
      }).success,
    ).toBe(false);
  });

  it('refuses an empty rule, an empty group and an empty option list', () => {
    expect(ProductRuleDefinitionSchema.safeParse({ match: 'all', conditions: [] }).success).toBe(false);
    expect(
      ProductRuleDefinitionSchema.safeParse({ match: 'all', conditions: [{ kind: 'group', match: 'all', conditions: [] }] }).success,
    ).toBe(false);
    expect(
      ProductRuleDefinitionSchema.safeParse({
        match: 'all',
        conditions: [{ kind: 'attribute_choice', attributeKey: 'brand', optionKeys: [] }],
      }).success,
    ).toBe(false);
  });

  it(`counts at most ${PRODUCT_RULE_MAX_CONDITIONS} conditions in total, groups included`, () => {
    expect(PRODUCT_RULE_MAX_CONDITIONS).toBe(20);
    const twenty = Array.from({ length: 20 }, (_, i) => attr(`a${i}`));
    expect(ProductRuleDefinitionSchema.safeParse({ match: 'all', conditions: twenty }).success).toBe(true);
    expect(
      ProductRuleDefinitionSchema.safeParse({
        match: 'all',
        conditions: [...twenty.slice(0, 10), { kind: 'group', match: 'any', conditions: twenty.slice(0, 11) }],
      }).success,
    ).toBe(false);
  });

  it('bounds attribute keys and option keys', () => {
    expect(ProductRuleDefinitionSchema.safeParse({ match: 'all', conditions: [attr('x'.repeat(101))] }).success).toBe(false);
    expect(
      ProductRuleDefinitionSchema.safeParse({
        match: 'all',
        conditions: [{ kind: 'attribute_choice', attributeKey: 'brand', optionKeys: Array.from({ length: 101 }, (_, i) => `o${i}`) }],
      }).success,
    ).toBe(false);
  });
});

describe('website rule preview body (TM-11)', () => {
  it('bounds the channel list', () => {
    expect(
      websiteRulePreviewCreateBodySchema.safeParse({ kind: 'attach', productRuleId: UUID, salesChannelIds: [UUID_2] }).success,
    ).toBe(true);
    expect(websiteRulePreviewCreateBodySchema.safeParse({ kind: 'attach', productRuleId: UUID, salesChannelIds: [] }).success).toBe(false);
    expect(
      websiteRulePreviewCreateBodySchema.safeParse({
        kind: 'attach',
        productRuleId: UUID,
        salesChannelIds: Array.from({ length: 51 }, () => UUID_2),
      }).success,
    ).toBe(false);
  });
});

describe('overview (FR-023, FR-024, FR-026, FR-086)', () => {
  it('names every role effect', () => {
    expect(productVisibilityRoleEffectSchema.options).toEqual([
      'unrestricted',
      'mapped_unrestricted',
      'mapped',
      'unmappable_unrestricted',
      'mapping_without_effect',
      'sees_no_products',
    ]);
  });

  it('parses a full overview', () => {
    const parsed = productVisibilityOverviewResponseSchema.parse({
      currencies: [
        {
          code: 'PLN',
          active: true,
          designation: { priceListId: UUID, salesChannelId: UUID_2 },
          designationStatus: { inForce: false, reason: 'outside_schedule', window: { startsAt: null, endsAt: null } },
          servedGeneration: 3,
          building: false,
        },
        { code: 'USD', active: false, designation: null, designationStatus: null, servedGeneration: null, building: false },
      ],
      categories: [
        {
          id: UUID,
          name: 'Wholesale',
          version: 1,
          conditions: [{ currencyCode: 'USD', threshold: 'gt_zero' }],
          mappedRoleIds: [UUID_2],
        },
      ],
      roles: [
        { roleId: UUID_2, code: 'sales', name: 'Sales', effect: 'mapped', categoryId: UUID, warnings: ['audit_logs_read'] },
        { roleId: UUID, code: 'platform_admin', name: 'Admin', effect: 'unmappable_unrestricted', warnings: [] },
      ],
      productRules: [],
      websiteRuleAttachments: [],
    });
    expect(parsed.roles[0]?.warnings).toEqual(['audit_logs_read']);
  });

  it('refuses an unknown warning', () => {
    expect(
      productVisibilityOverviewResponseSchema.safeParse({
        currencies: [],
        categories: [],
        roles: [{ roleId: UUID, code: 'x', name: 'x', effect: 'mapped', warnings: ['orders_read'] }],
        productRules: [],
        websiteRuleAttachments: [],
      }).success,
    ).toBe(false);
  });
});

describe('designation status (contracts/ports.md §3)', () => {
  it('in force carries a window; not in force carries a reason', () => {
    expect(designationStatusSchema.safeParse({ inForce: true, window: { startsAt: null, endsAt: null } }).success).toBe(true);
    expect(designationStatusSchema.safeParse({ inForce: false, reason: 'not_regular', window: null }).success).toBe(true);
    expect(designationStatusSchema.safeParse({ inForce: false, reason: 'gone', window: null }).success).toBe(false);
  });
});

describe('scope and predicate types (TM-3)', () => {
  it('the scope has an explicit system member and the predicate never reads null', () => {
    expectTypeOf<Extract<AdminProductVisibilityScope, { kind: 'system' }>>().not.toBeNever();
    expectTypeOf<null>().not.toMatchTypeOf<VisibilityPredicate>();
    expectTypeOf<VisibilityPredicate['kind']>().toEqualTypeOf<'none' | 'sql' | 'deny'>();
  });
});

describe('vocabularies', () => {
  it('permission, setting and self-lifting codes', () => {
    expect(PRODUCT_VISIBILITY_PERMISSIONS).toEqual({ READ: 'product_visibility:read', MANAGE: 'product_visibility:manage' });
    expect(PRODUCT_VISIBILITY_SETTING_CODES.MODULE_ENABLED).toBe('product_visibility_rules.module_enabled');
    expect([...PRODUCT_VISIBILITY_SELF_LIFTING_PERMISSIONS].sort()).toEqual(
      ['*', 'admin_users:manage', 'platform.modules.activate', 'product_visibility:manage'].sort(),
    );
  });

  it('module error codes are spelled as their own keys', () => {
    for (const [key, value] of Object.entries(PRODUCT_VISIBILITY_ERROR_CODES)) expect(value).toBe(key);
    expect(Object.keys(PRODUCT_VISIBILITY_ERROR_CODES)).toHaveLength(9);
  });
});

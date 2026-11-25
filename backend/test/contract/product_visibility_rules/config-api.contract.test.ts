import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  errorEnvelopeSchema,
  productVisibilityCategorySchema,
  productVisibilityDesignationOptionsResponseSchema,
  productVisibilityDesignationResponseSchema,
  productVisibilityOverviewResponseSchema,
  productVisibilityRoleEffectSchema,
  productVisibilityRoleMappingResponseSchema,
} from '@endora-commerce/contracts';
import { setupBackendServer, teardownBackendServer, type BackendServerHandle } from '../../helpers/test-server.js';
import {
  call,
  clearConfiguration,
  forgetTestRoles,
  roleWith,
} from '../../integration/product_visibility_rules/fixtures.js';

/**
 * Spec 193 T025 — the configuration API answers the shapes `@endora-commerce/contracts` publishes
 * (`contracts/admin-api.md` §1): every success under `data`, the mapping target union
 * (category / unrestricted / null), every role effect the overview can report, and the module's
 * refusals in the platform's error envelope.
 */
describe('product visibility configuration API — contract (spec 193)', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer();
    await clearConfiguration(h);
  }, 5 * 60_000);

  afterAll(async () => {
    await clearConfiguration(h);
    forgetTestRoles();
    await teardownBackendServer(h);
  });

  it('category, mapping, designation and overview answers match their schemas', async () => {
    const created = await call(h, 'POST', '/categories', {
      payload: { name: 'Contract', conditions: [{ currencyCode: 'PLN', threshold: 'gte_zero' }] },
    });
    expect(created.status).toBe(201);
    const category = productVisibilityCategorySchema.parse(created.body.data);
    const patched = await call(h, 'PATCH', `/categories/${category.id}`, { payload: { name: 'Contract 2' } });
    productVisibilityCategorySchema.parse(patched.body.data);

    const mapped = await roleWith(h, ['rfqs:handle']);
    const unrestricted = await roleWith(h, ['rfqs:handle']);
    const failClosed = await roleWith(h, ['rfqs:handle']);
    const gained = await roleWith(h, ['rfqs:handle']);
    for (const [role, target] of [
      [mapped, { kind: 'category', categoryId: category.id }],
      [unrestricted, { kind: 'unrestricted' }],
      [gained, { kind: 'category', categoryId: category.id }],
    ] as const) {
      const res = await call(h, 'PUT', `/role-mappings/${role.roleId}`, { payload: { target } });
      expect(productVisibilityRoleMappingResponseSchema.parse(res.body.data)).toEqual({ roleId: role.roleId, target });
    }
    const cleared = await call(h, 'PUT', `/role-mappings/${failClosed.roleId}`, { payload: { target: null } });
    expect(productVisibilityRoleMappingResponseSchema.parse(cleared.body.data).target).toBeNull();
    await h
      .em()
      .getConnection()
      .execute(`update "admin_roles" set "permissions" = ?::jsonb where "id" = ?`, [JSON.stringify(['*']), gained.roleId]);

    const options = await call(h, 'GET', '/designations/PLN/options');
    productVisibilityDesignationOptionsResponseSchema.parse(options.body.data);
    const clearedDesignation = await call(h, 'DELETE', '/designations/PLN');
    expect(productVisibilityDesignationResponseSchema.parse(clearedDesignation.body.data).designation).toBeNull();

    const overview = productVisibilityOverviewResponseSchema.parse((await call(h, 'GET', '/overview')).body.data);
    const effects = new Set(overview.roles.map((r) => r.effect));
    // Every effect but `unrestricted`-by-default is produced by this fixture; that one is any plain role.
    for (const effect of productVisibilityRoleEffectSchema.options) expect(effects.has(effect), effect).toBe(true);
  });

  it('the module’s refusals are the platform’s error envelope', async () => {
    const created = await call(h, 'POST', '/categories', {
      payload: { name: 'In use', conditions: [{ currencyCode: 'EUR', threshold: 'gt_zero' }] },
    });
    const role = await roleWith(h, ['rfqs:handle']);
    await call(h, 'PUT', `/role-mappings/${role.roleId}`, { payload: { target: { kind: 'category', categoryId: created.body.data.id } } });
    const inUse = await call(h, 'DELETE', `/categories/${created.body.data.id}`);
    expect(errorEnvelopeSchema.parse(inUse.body).error).toMatchObject({
      code: 'VISIBILITY_CATEGORY_IN_USE',
      details: [{ path: 'roleIds', issue: role.roleId }],
    });

    const selfLifting = await roleWith(h, ['admin_users:manage']);
    const notMappable = await call(h, 'PUT', `/role-mappings/${selfLifting.roleId}`, { payload: { target: { kind: 'unrestricted' } } });
    expect(errorEnvelopeSchema.parse(notMappable.body).error.code).toBe('ROLE_NOT_MAPPABLE');

    const invalid = await call(h, 'PUT', '/designations/PLN', {
      payload: { priceListId: '00000000-0000-4000-8000-000000000193', salesChannelId: '00000000-0000-4000-8000-000000000193' },
    });
    expect(errorEnvelopeSchema.parse(invalid.body).error).toMatchObject({
      code: 'DESIGNATION_INVALID',
      details: [{ path: 'priceListId', issue: 'not_found' }],
    });
  });
});

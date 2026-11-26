import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { CatalogProductScopeWritePort, FieldPath } from '@endora-commerce/contracts';
import { setupBackendServer, teardownBackendServer, type BackendServerHandle } from '../../helpers/test-server.js';
import { withModuleOff } from '../../helpers/off-state.js';
import {
  attachRuleBySql,
  bridgeProduct,
  clearWebsiteRules,
  createChannel,
  createProduct,
  isMember,
  membershipPort,
} from './website-rule-fixtures.js';

/**
 * `product_visibility_rules` off-state — kernel governance (spec 193 T069; FR-073, R-15, TM-10).
 * While the module is off, on either axis, its governor governs nothing although its attachment
 * rows are kept: no membership write is refused or skipped, an automatic create on a governed
 * default lands there as before, and a channel delete rebinds product orphans onto a default with
 * an attachment row (T100 case 5). Values for a governed channel the product is not a member of
 * are refused as today (`SCOPE_INVALID`, FR-073 — the FR-093 allowance is the module's).
 *
 * The reactivation `beforeCommit` hook (T068) is not built yet; its "hook not run while off" case
 * joins this file with it.
 */
const COOKIE = { cookie: 'b2b_session=stub-admin-session' };

describe('product_visibility_rules off-state — governance (spec 193, T069)', () => {
  let h: BackendServerHandle;
  let governed: string;
  let defaultId: string;
  const sql = <T = Record<string, unknown>>(s: string, params: unknown[] = []) => h.orm.em.fork().getConnection().execute<T[]>(s, params);
  const codeOf = async (id: string) => (await sql<{ code: string }>(`select "code" from "sales_channels" where "id" = ?`, [id]))[0]!.code;

  beforeAll(async () => {
    h = await setupBackendServer();
    await clearWebsiteRules(h);
    governed = await createChannel(h, 'og-gov');
    defaultId = (await sql<{ id: string }>(`select "id" from "sales_channels" where "system_default" = true`))[0]!.id;
    await attachRuleBySql(h, [governed, defaultId], 'Governs while on');
  }, 5 * 60_000);

  afterAll(async () => {
    await clearWebsiteRules(h);
    await teardownBackendServer(h);
  });

  it('positive control: while on, a manual write is refused and an automatic one skipped', async () => {
    const product = await createProduct(h, { color: 'red' });
    await expect(membershipPort(h).addToChannel(governed, 'product', product, { onGoverned: 'refuse' })).rejects.toMatchObject({ statusCode: 409 });
    expect(await membershipPort(h).bindToDefaultIfEmpty('product', product)).toEqual({ changed: false, skippedGovernedChannelIds: [defaultId] });
  });

  it.each(['deactivated', 'platform-unavailable'] as const)('while %s: no write refused or skipped', async (axis) => {
    const product = await createProduct(h, { color: 'red' });
    await withModuleOff('product_visibility_rules', axis, async () => {
      expect(await membershipPort(h).bindToDefaultIfEmpty('product', product)).toEqual({ changed: true });
      expect(await membershipPort(h).addToChannel(governed, 'product', product, { onGoverned: 'refuse' })).toEqual({ changed: true });
      const del = await h.app.inject({ method: 'DELETE', url: `/api/v1/admin/sales-channels/${await codeOf(governed)}/product/${product}`, headers: COOKIE });
      expect(del.statusCode, del.body).toBe(200);
      expect(await isMember(h, governed, product)).toBe(false);
    });
    // Back on: the attachment rows were kept and govern again.
    await expect(membershipPort(h).addToChannel(governed, 'product', product, { onGoverned: 'refuse' })).rejects.toMatchObject({ statusCode: 409 });
  });

  it.each(['deactivated', 'platform-unavailable'] as const)('while %s: a channel delete rebinds product orphans onto the default (T100 case 5)', async (axis) => {
    const doomed = await createChannel(h, 'og-del');
    const product = await createProduct(h, { color: 'red' });
    await bridgeProduct(h, doomed, product);
    await withModuleOff('product_visibility_rules', axis, async () => {
      const res = await h.app.inject({ method: 'DELETE', url: `/api/v1/admin/sales-channels/${await codeOf(doomed)}?fallbackToDefault=true`, headers: COOKIE });
      expect(res.statusCode, res.body).toBe(204);
    });
    expect(await isMember(h, defaultId, product)).toBe(true);
  });

  it.each(['deactivated', 'platform-unavailable'] as const)('while %s: values for a governed channel the product is not on are refused as today (FR-073)', async (axis) => {
    const product = await createProduct(h, { color: 'red' });
    const port = (h.container.cradle as unknown as { catalogProductScopeWritePort: CatalogProductScopeWritePort }).catalogProductScopeWritePort;
    await withModuleOff('product_visibility_rules', axis, async () => {
      const result = await port.applyScopes(
        product,
        { cells: [{ scope: { level: 'channel', channelId: governed }, field: 'name' as FieldPath, op: { op: 'set', value: 'Pending name' } }] },
        { source: 'pim_connector' },
      );
      expect(result.applied).toBe(0);
      expect(result.refused.map((r) => r.code)).toEqual(['SCOPE_INVALID']);
    });
  });
});

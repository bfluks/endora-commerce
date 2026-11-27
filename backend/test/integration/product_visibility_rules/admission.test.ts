import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { CatalogProductScopeWritePort, FieldPath } from '@endora-commerce/contracts';
import { setupBackendServer, teardownBackendServer, type BackendServerHandle } from '../../helpers/test-server.js';
import { ADMIN, scopedValuesFixture, type ScopedValuesFixture } from '../../helpers/scoped-values-fixture.js';
import { createImportProfile } from '../../helpers/import-profile.js';
import { attachRuleBySql, clearWebsiteRules, isMember, websiteRules } from './website-rule-fixtures.js';

/**
 * Spec 193 T068 — the reactivation `beforeCommit` hooks on every catalog Command T049 declares
 * (FR-092, FR-093, FR-059, FR-079; US4-3, US4-6, SC-005; owner H2 A, Q1 A, N2, N3, N5).
 *
 * - A global transition to active, or an un-archive, of a product on a governed channel removes
 *   that membership in the same transaction (governor token), deletes its admissions row and
 *   marks the product; the rule re-admits it on its next evaluation (≤ 5 min).
 * - A **channel** status (scope level `channel`) moving to active on a governed channel removes
 *   that membership — except the first channel-status write after admission (Q1 A), which only
 *   sets `post_admission_status_seen`. A per-language status never counts (H2 A, N3).
 * - Inherit: a stored channel status cleared to inherit counts when the global status is active.
 * - Each token removal deletes the admissions row; a re-admission inserts a fresh one, so the
 *   exemption applies again (N2).
 *
 * Every catalog write also marks the product through `product.updated.v1` (T059), so "not marked"
 * is not asserted; a removal is.
 */
describe('website-rule admission and reactivation (spec 193, T068)', () => {
  let h: BackendServerHandle;
  let fx: ScopedValuesFixture;
  let colour: string;
  let governed: string;
  let governedCode: string;
  let profileId: string;
  const PL = 'pl-PL';
  const service = () => websiteRules(h) as unknown as { markProducts(ids: readonly string[]): Promise<void>; evaluateMarked(): Promise<{ changed: number }> };
  const port = () => (h.container.cradle as unknown as { catalogProductScopeWritePort: CatalogProductScopeWritePort }).catalogProductScopeWritePort;
  const api = (method: 'PUT' | 'PATCH' | 'POST', url: string, payload?: object) =>
    h.app.inject({ method, url: `/api/v1/admin/catalog/products${url}`, ...ADMIN, ...(payload ? { payload } : {}) });

  async function ok(res: Awaited<ReturnType<typeof api>>): Promise<void> {
    expect(res.statusCode, res.body).toBeLessThan(300);
  }

  /** A product meeting the rule, not on the governed channel yet. */
  const product = (): Promise<string> => fx.product({ attributeValues: { [colour]: 'red' } });

  /** The rule's next evaluation of `id` (what the debounced job does). */
  async function evaluate(id: string): Promise<void> {
    await service().markProducts([id]);
    await service().evaluateMarked();
  }

  async function ledger(id: string): Promise<{ seen: boolean } | null> {
    const [row] = await fx.sql<{ seen: boolean }>(
      `select post_admission_status_seen as seen from website_rule_admissions where sales_channel_id = ? and product_id = ?`,
      [governed, id],
    );
    return row ?? null;
  }

  async function marked(id: string): Promise<boolean> {
    return (await fx.sql(`select 1 from website_rule_stale_products where product_id = ?`, [id])).length > 0;
  }

  async function unmark(id: string): Promise<void> {
    await fx.sql(`delete from website_rule_stale_products where product_id = ?`, [id]);
  }

  /** The channel status of `id` on the governed channel, through the scopes update (`product.scopes.update`). */
  const channelStatus = async (id: string, status: 'active' | 'inactive' | { inherit: true }) =>
    ok(await api('PATCH', `/${id}/scopes`, { channels: [{ channelId: governed, status }] }));

  async function admitted(id: string): Promise<void> {
    await evaluate(id);
    expect(await isMember(h, governed, id)).toBe(true);
    expect(await ledger(id)).toEqual({ seen: false });
    await unmark(id);
  }

  async function evicted(id: string): Promise<void> {
    expect(await isMember(h, governed, id)).toBe(false);
    expect(await ledger(id)).toBeNull();
    expect(await marked(id)).toBe(true);
  }

  beforeAll(async () => {
    h = await setupBackendServer();
    await clearWebsiteRules(h);
    fx = scopedValuesFixture(() => h);
    colour = await fx.attribute({ key: 'adm_colour', valueType: 'select', options: ['red', 'blue'] });
    governed = await fx.channel([PL]);
    governedCode = (await fx.sql<{ code: string }>(`select code from sales_channels where id = ?`, [governed]))[0]!.code;
    await attachRuleBySql(h, [governed], `Admission ${fx.run}`, {
      match: 'all',
      conditions: [{ kind: 'attribute_choice', attributeKey: colour, optionKeys: ['red'] }],
    });
    profileId = await createImportProfile(h);
  }, 5 * 60_000);

  afterAll(async () => {
    await clearWebsiteRules(h);
    await fx.cleanup();
    await teardownBackendServer(h);
  });

  it('a product meeting the rule is never on the channel before admission, and is after it (US4-6, SC-005)', async () => {
    const id = await product();
    expect(await isMember(h, governed, id)).toBe(false);
    await admitted(id);
  });

  describe('global reactivation (FR-092)', () => {
    it('product.update inactive → active removes the governed membership, deletes the admission and marks; re-admitted on evaluation', async () => {
      const id = await product();
      await admitted(id);
      await ok(await api('PATCH', `/${id}`, { status: 'inactive' }));
      expect(await isMember(h, governed, id)).toBe(true); // not a reactivation
      await ok(await api('PATCH', `/${id}`, { status: 'active' }));
      await evicted(id);
      await admitted(id);
    });

    it('product.restore (un-archive) of an active product removes it and marks', async () => {
      const id = await product();
      await admitted(id);
      await ok(await api('POST', `/${id}/archive`));
      await ok(await api('POST', `/${id}/restore`));
      await evicted(id);
    });

    it('a bulk update to active removes it and marks', async () => {
      const id = await product();
      await admitted(id);
      await fx.sql(`update products set status = 'inactive' where id = ?`, [id]);
      await ok(await api('POST', '/bulk-update', { productIds: [id], fields: { status: 'active' } }));
      await evicted(id);
    });

    it('a product deactivated is never re-admitted while so (FR-079, N5)', async () => {
      const id = await product();
      await ok(await api('PATCH', `/${id}`, { status: 'inactive' }));
      await evaluate(id);
      expect(await isMember(h, governed, id)).toBe(false);
      await fx.sql(`update products set archived_at = now(), status = 'active' where id = ?`, [id]);
      await evaluate(id);
      expect(await isMember(h, governed, id)).toBe(false);
    });
  });

  describe('channel status (FR-092, FR-093 Q1 A, N2)', () => {
    it('the first channel-status write after admission is exempt, even inactive → active; the next one is not; re-admission exempts again', async () => {
      const id = await product();
      await channelStatus(id, 'inactive'); // stored pending admission (FR-093)
      await admitted(id);

      await channelStatus(id, 'active'); // first write after admission: exempt
      expect(await isMember(h, governed, id)).toBe(true);
      expect(await ledger(id)).toEqual({ seen: true });

      await channelStatus(id, 'inactive'); // not to active: no reactivation
      expect(await isMember(h, governed, id)).toBe(true);

      await channelStatus(id, 'active'); // a reactivation
      await evicted(id);

      await channelStatus(id, 'inactive'); // pending again
      await admitted(id);
      await channelStatus(id, 'active'); // first after re-admission: exempt again
      expect(await isMember(h, governed, id)).toBe(true);
      expect(await ledger(id)).toEqual({ seen: true });
    });

    it('a per-language status inactive → active through applyScopes never counts and leaves the flag unset (H2 A, N3)', async () => {
      const id = await product();
      await admitted(id);
      const write = (value: 'active' | 'inactive') =>
        port().applyScopes(
          id,
          { cells: [{ scope: { level: 'channel_language', channelId: governed, languageCode: PL }, field: 'status' as FieldPath, op: { op: 'set', value } }] },
          { source: 'pim_connector' },
        );
      expect((await write('inactive')).refused).toEqual([]);
      expect((await write('active')).refused).toEqual([]);
      expect(await isMember(h, governed, id)).toBe(true);
      expect(await ledger(id)).toEqual({ seen: false });
    });

    it('a channel status to active through the connector (product.scoped_values.import) is a reactivation', async () => {
      const id = await product();
      await admitted(id);
      await channelStatus(id, 'inactive'); // first write: sets the flag
      const result = await port().applyScopes(
        id,
        { cells: [{ scope: { level: 'channel', channelId: governed }, field: 'status' as FieldPath, op: { op: 'set', value: 'active' } }] },
        { source: 'pim_connector' },
      );
      expect(result.refused).toEqual([]);
      await evicted(id);
    });

    it('a channel status to active through the products CSV import is a reactivation', async () => {
      const id = await product();
      await admitted(id);
      await channelStatus(id, 'inactive');
      const [{ sku }] = (await fx.sql<{ sku: string }>(`select sku from products where id = ?`, [id])) as [{ sku: string }];
      const res = await h.app.inject({
        method: 'POST',
        url: `/api/v1/admin/import/products?profileId=${profileId}`,
        ...ADMIN,
        headers: { 'content-type': 'text/csv' },
        payload: [`sku,status,visibility,name,description,status@${governedCode}`, `${sku},,,,,active`].join('\n'),
      });
      expect(res.statusCode, res.body).toBe(200);
      await evicted(id);
    });

    it('a channel status to active through the admin save (product.scoped_values.save) is a reactivation', async () => {
      const id = await product();
      await admitted(id);
      await channelStatus(id, 'inactive');
      const res = await fx.put(id, { channelId: governed }, { status: 'active' }, { version: (await fx.read(id)).version });
      expect(res.statusCode, res.body).toBe(200);
      await evicted(id);
    });

    it('remove + re-admit keeps the channel-scoped values', async () => {
      const id = await product();
      await admitted(id);
      await fx.save(id, { channelId: governed, languageCode: PL }, { name: 'Kept' });
      await channelStatus(id, 'inactive');
      await channelStatus(id, 'active');
      await evicted(id);
      await admitted(id);
      expect((await fx.read(id, { channelId: governed, languageCode: PL })).fields.name.value).toBe('Kept');
    });
  });

  describe('inherit (FR-092 as worded at 35b32350d)', () => {
    it('(1) a stored inactive cleared to inherit while the global status is active is a reactivation', async () => {
      const id = await product();
      await admitted(id);
      await channelStatus(id, 'inactive'); // first write: exempt, sets the flag
      await channelStatus(id, { inherit: true });
      await evicted(id);
      await admitted(id);
    });

    it('(2) the same clear while the global status is inactive is not: nothing removed', async () => {
      const id = await product();
      await admitted(id);
      await channelStatus(id, 'inactive');
      await fx.sql(`update products set status = 'inactive' where id = ?`, [id]);
      await channelStatus(id, { inherit: true });
      expect(await isMember(h, governed, id)).toBe(true);
      expect(await ledger(id)).toEqual({ seen: true });
    });

    it('(3) the first channel-status write after admission that writes inherit is still exempt (FR-093)', async () => {
      const id = await product();
      await channelStatus(id, 'inactive'); // pending
      await admitted(id);
      await channelStatus(id, { inherit: true });
      expect(await isMember(h, governed, id)).toBe(true);
      expect(await ledger(id)).toEqual({ seen: true });
    });
  });
});

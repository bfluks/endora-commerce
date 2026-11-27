import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupBackendServer, teardownBackendServer, type BackendServerHandle } from '../../helpers/test-server.js';
import { withModuleOff } from '../../helpers/off-state.js';
import { Product } from '../../helpers/package-entities.js';
import {
  setupCatalogVisibilityFixture,
  type CatalogVisibilityFixture,
} from '../../helpers/catalog-visibility-fixture.js';
import { ADMIN, flagsOf, roleWith, settleFlags, type TestRole } from '../product_visibility_rules/fixtures.js';

/**
 * Spec 193 T037 — the catalog admin list reads for a restricted administrator (US1-4, US1-6,
 * US1-11, US1-12; FR-030 – FR-034, FR-036; SC-002, SC-003; threat model TM-6, TM-14).
 *
 * Thirty products share a stamp; twelve carry a PLN base price and so meet the restricted role's
 * category ("PLN > 0"). Every list read — the list itself, its total and badges, select-all, the
 * batch read, variants and global search — answers the twelve and nothing else, cut in the
 * statement that pages. The platform administrator and an unrestricted role answer byte for byte
 * what they answer with the module off.
 */
const LIST = '/api/v1/admin/catalog/products';

describe('catalog admin lists — narrowed by the visibility category (spec 193, T037)', () => {
  let h: BackendServerHandle;
  let fx: CatalogVisibilityFixture;
  let unrestricted: TestRole;
  const stamp = `vl${randomUUID().slice(0, 8)}`;
  // The lifecycle products carry a stamp of their own, so the thirty above stay thirty.
  const lcStamp = `lc${randomUUID().slice(0, 8)}`;
  const priced: string[] = [];
  const unpriced: string[] = [];
  const lifecycle: Record<'inactive' | 'archived' | 'deleted', string> = {} as never;

  const get = async (url: string, cookies: Record<string, string>) => {
    const res = await h.app.inject({ method: 'GET', url, cookies });
    return { status: res.statusCode, body: res.json(), headers: res.headers, raw: res.body };
  };
  const post = async (url: string, payload: unknown, cookies: Record<string, string>) => {
    const res = await h.app.inject({ method: 'POST', url, cookies, payload: payload as never });
    return { status: res.statusCode, body: res.json(), headers: res.headers, raw: res.body };
  };

  beforeAll(async () => {
    h = await setupBackendServer();
    fx = await setupCatalogVisibilityFixture(h);
    // Unmapped and without `rfqs:handle`: unrestricted (FR-023).
    unrestricted = await roleWith(h, ['catalog:read', 'catalog:write'], 'cvu');
    const em = h.em();
    const make = (n: number, extra: Partial<{ status: 'active' | 'inactive'; stamp: string }> = {}) =>
      em.create(Product, {
        sku: `${extra.stamp ?? stamp}-${String(n).padStart(2, '0')}`,
        slug: `${extra.stamp ?? stamp}-${n}`,
        type: 'simple',
        status: extra.status ?? 'active',
        name: `VL ${extra.stamp ?? stamp} ${String(n).padStart(2, '0')}`,
        description: 'visibility list',
        visibility: 'public',
        attributeValues: {},
      });
    const rows = Array.from({ length: 30 }, (_, i) => make(i + 1));
    const inactive = make(31, { status: 'inactive', stamp: lcStamp });
    const archived = make(32, { stamp: lcStamp });
    archived.archivedAt = new Date();
    const deleted = make(33, { stamp: lcStamp });
    deleted.deletedAt = new Date();
    await em.persist([...rows, inactive, archived, deleted]).flush();
    for (const [i, row] of rows.entries()) (i % 5 < 2 ? priced : unpriced).push(row.id);
    lifecycle.inactive = inactive.id;
    lifecycle.archived = archived.id;
    lifecycle.deleted = deleted.id;
    const tier = [{ minQuantity: 1, maxQuantity: null, amount: '10' }];
    for (const id of [...priced, inactive.id, archived.id, deleted.id]) {
      await fx.f.setBase({ id }, { product: tier, variants: {} });
    }
    await flagsOf(h).requestRebuild(['PLN']);
    await settleFlags(h);
  }, 5 * 60_000);

  afterAll(async () => {
    await fx?.teardown();
    await teardownBackendServer(h);
  });

  it('fixture: 30 stamped products, 12 of them priced', () => {
    expect(priced).toHaveLength(12);
    expect(unpriced).toHaveLength(18);
  });

  it('US1-4, SC-002: the total is 12, the pages hold 10 and 2, cut in the statement that pages', async () => {
    const first = await get(`${LIST}?q=${stamp}&pageSize=10&page=0`, fx.restricted.cookies);
    const second = await get(`${LIST}?q=${stamp}&pageSize=10&page=1`, fx.restricted.cookies);
    expect(first.status, first.raw).toBe(200);
    expect(first.body.pagination.total).toBe(12);
    expect(first.body.data).toHaveLength(10);
    expect(second.body.data).toHaveLength(2);
    expect(second.body.pagination.hasMore).toBe(false);
    const seen = [...first.body.data, ...second.body.data].map((p: { id: string }) => p.id).sort();
    expect(seen).toEqual([...priced].sort());
  });

  it('FR-031: the badges count visible products only, and agree with the unfiltered list', async () => {
    const restricted = await get(`${LIST}?pageSize=1`, fx.restricted.cookies);
    const admin = await get(`${LIST}?pageSize=1`, ADMIN);
    expect(restricted.body.counts.all).toBe(restricted.body.pagination.total);
    expect(restricted.body.counts.active + restricted.body.counts.inactive).toBe(restricted.body.counts.all);
    expect(restricted.body.counts.all).toBeLessThan(admin.body.counts.all);
    const archivedOnly = await get(`${LIST}?archived=only&pageSize=1`, fx.restricted.cookies);
    expect(restricted.body.counts.archived).toBe(archivedOnly.body.pagination.total);
  });

  it('US1-6, FR-023: a role with no category sees an empty list, zero badges, and is told why', async () => {
    const res = await get(`${LIST}?pageSize=5`, fx.noCategory.cookies);
    expect(res.status, res.raw).toBe(200);
    expect(res.body.data).toEqual([]);
    expect(res.body.pagination.total).toBe(0);
    expect(res.body.counts).toEqual({ all: 0, active: 0, inactive: 0, archived: 0 });
    expect(res.body.visibility).toEqual({ restricted: true, reason: 'no_category' });
    const searched = await get(`${LIST}?q=${stamp}`, fx.noCategory.cookies);
    expect(searched.body.counts).toEqual({ all: 0, active: 0, inactive: 0, archived: 0 });
  });

  it('a restricted list names its category; an unrestricted one carries no visibility key (SC-003)', async () => {
    const restricted = await get(`${LIST}?pageSize=1`, fx.restricted.cookies);
    expect(restricted.body.visibility).toMatchObject({ restricted: true });
    expect(typeof restricted.body.visibility.categoryName).toBe('string');
    expect(restricted.body.visibility.reason).toBeUndefined();
    for (const cookies of [ADMIN, unrestricted.cookies]) {
      expect('visibility' in (await get(`${LIST}?pageSize=1`, cookies)).body).toBe(false);
    }
  });

  it('FR-032: select-all and the batch read answer the visible products only', async () => {
    const resolved = await post(`${LIST}/resolve-ids`, { q: stamp }, fx.restricted.cookies);
    expect(resolved.status, resolved.raw).toBe(200);
    expect([...resolved.body.data.productIds].sort()).toEqual([...priced].sort());
    expect(resolved.body.data.total).toBe(12);
    const batch = await post(`${LIST}/batch-by-id`, { ids: [...priced, ...unpriced], pageSize: 50 }, fx.restricted.cookies);
    expect(batch.status, batch.raw).toBe(200);
    expect(batch.body.pagination.total).toBe(12);
    expect(batch.body.data.map((p: { id: string }) => p.id).sort()).toEqual([...priced].sort());
    const none = await post(`${LIST}/resolve-ids`, { q: stamp }, fx.noCategory.cookies);
    expect(none.body.data).toEqual({ productIds: [], total: 0 });
  });

  it('US1-12, RQ-3 A: a visible configurable product lists its qualifying variant only', async () => {
    const restricted = await get(`${LIST}/${fx.configurable.id}/variants`, fx.restricted.cookies);
    expect(restricted.status, restricted.raw).toBe(200);
    expect(restricted.body.data.map((v: { id: string }) => v.id)).toEqual([fx.configurable.visibleVariant]);
    const admin = await get(`${LIST}/${fx.configurable.id}/variants`, ADMIN);
    expect(admin.body.data.map((v: { id: string }) => v.id).sort()).toEqual(
      [fx.configurable.visibleVariant, fx.configurable.hiddenVariant].sort(),
    );
  });

  it('US1-12: saving a visible parent leaves its non-qualifying variant unchanged', async () => {
    const variantRow = async () =>
      (
        await h
          .em()
          .getConnection()
          .execute<Array<{ row: unknown }>>(`select row_to_json(v) as "row" from "product_variants" v where v."id" = ?`, [
            fx.configurable.hiddenVariant,
          ])
      )[0]?.row;
    const before = await variantRow();
    const res = await h.app.inject({
      method: 'PATCH',
      url: `${LIST}/${fx.configurable.id}`,
      cookies: fx.restricted.cookies,
      payload: { description: `saved by a restricted admin ${stamp}` },
    });
    expect(res.statusCode, res.body).toBe(200);
    expect(await variantRow()).toEqual(before);
  });

  it('FR-034: global search finds the visible products only, and "more" counts visible rows', async () => {
    const url = `/api/v1/admin/global-search?q=${stamp}&entityTypes=catalog.product&language=en&limit=12`;
    const restricted = await get(url, fx.restricted.cookies);
    expect(restricted.status, restricted.raw).toBe(200);
    const group = restricted.body.data.groups.find((g: { entityType: string }) => g.entityType === 'catalog.product');
    expect(group.hits.map((hit: { id: string }) => hit.id).sort()).toEqual([...priced].sort());
    expect(group.hasMore).toBe(false);
    const admin = (await get(url, ADMIN)).body.data.groups.find((g: { entityType: string }) => g.entityType === 'catalog.product');
    expect(admin.hasMore).toBe(true);
  });

  it('FR-079 (admin side): no visibility rule resurfaces an inactive, archived or deleted product', async () => {
    for (const cookies of [fx.restricted.cookies, ADMIN]) {
      const active = (await get(`${LIST}?q=${lcStamp}&status=active&pageSize=50`, cookies)).body.data.map((p: { id: string }) => p.id);
      expect(active).not.toContain(lifecycle.inactive);
      const listed = (await get(`${LIST}?q=${lcStamp}&pageSize=50`, cookies)).body.data.map((p: { id: string }) => p.id);
      expect(listed).not.toContain(lifecycle.archived);
      const everything = (await get(`${LIST}?q=${lcStamp}&archived=include&pageSize=50`, cookies)).body.data.map(
        (p: { id: string }) => p.id,
      );
      expect(everything).not.toContain(lifecycle.deleted);
      expect(everything).toContain(lifecycle.archived);
      expect(everything).toContain(lifecycle.inactive);
    }
  });

  it('FR-036, TM-14: the list answers are not cacheable, with the module on and off', async () => {
    const probes = async () => {
      for (const cookies of [ADMIN, fx.restricted.cookies]) {
        expect((await get(`${LIST}?pageSize=1`, cookies)).headers['cache-control']).toBe('private, no-store');
        expect((await post(`${LIST}/resolve-ids`, { q: stamp }, cookies)).headers['cache-control']).toBe('private, no-store');
        expect((await post(`${LIST}/batch-by-id`, { ids: priced }, cookies)).headers['cache-control']).toBe('private, no-store');
        expect((await get(`${LIST}/${fx.configurable.id}/variants`, cookies)).headers['cache-control']).toBe('private, no-store');
      }
    };
    await probes();
    await withModuleOff('product_visibility_rules', 'platform-unavailable', probes);
  });

  it('SC-003: the platform administrator and an unrestricted role answer byte for byte as with the module off', async () => {
    const urls = [`${LIST}?q=${stamp}&pageSize=10`, `${LIST}?pageSize=5&archived=include`, `${LIST}/${fx.configurable.id}/variants`];
    const read = async () => {
      const out: string[] = [];
      for (const cookies of [ADMIN, unrestricted.cookies]) {
        for (const url of urls) out.push((await get(url, cookies)).raw);
        out.push((await post(`${LIST}/resolve-ids`, { q: stamp }, cookies)).raw);
      }
      return out;
    };
    const on = await read();
    const off = await withModuleOff('product_visibility_rules', 'platform-unavailable', read);
    expect(on).toEqual(off);
    // And the restricted role is narrowed only while the module is on.
    const restrictedOff = await withModuleOff('product_visibility_rules', 'deactivated', () =>
      get(`${LIST}?q=${stamp}&pageSize=50`, fx.restricted.cookies),
    );
    expect(restrictedOff.body.pagination.total).toBe(30);
    expect('visibility' in restrictedOff.body).toBe(false);
  });
});

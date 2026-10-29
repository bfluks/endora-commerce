import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import {
  buyerChannelIds,
  createMinimumProduct,
  minimumFixtureRun,
  type MinimumProductFixture,
} from '../../helpers/order-minimum-fixture.js';
import { clearProductScopes, setChannelStatus } from '../../helpers/product-scope-fixture.js';

/**
 * Feature 163, Phase 6 (T045a) — a CMS product block reads through the two
 * catalogue requests `storefront/lib/page-builder/block-data.ts` makes
 * (`contracts/consumers.md` row 19): the category listing
 * (`GET /api/v1/catalog/products?categorySlug=&limit=`) and the product by its
 * stored slug (`GET /api/v1/catalog/products/:slug`, also behind the
 * single-product `ProductCard` block). Neither that file nor
 * `packages/cms-components/src/utils/block-data.ts` carries a predicate
 * of its own, so the block omits a product off at (C, L) and shows it where it
 * is on — through the catalogue's own seams (rows 1 and 3).
 */

const ADMIN = { b2b_session: 'stub-admin-session' };
const CHANNEL = { 'x-sales-channel': 'pl_retail' };

describe('163 — a CMS product block shows only available products [contract]', () => {
  let h: BackendServerHandle;
  const RUN = minimumFixtureRun();
  let channels: string[] = [];
  let off: MinimumProductFixture;
  let on: MinimumProductFixture;
  const categorySlug = `s163-block-${RUN}`;

  beforeAll(async () => {
    h = await setupBackendServer();
    const em = h.em();
    channels = await buyerChannelIds(em);
    off = await createMinimumProduct(em, { sku: `S163-CMS-OFF-${RUN}`, nameEn: 'Off', namePl: 'Wył', channelIds: channels });
    on = await createMinimumProduct(em, { sku: `S163-CMS-ON-${RUN}`, nameEn: 'On', namePl: 'Wł', channelIds: channels });
    await setChannelStatus(em, off.id, channels, 'inactive');
    const created = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/catalog/categories',
      cookies: ADMIN,
      payload: { name: { 'en-US': `163 block ${RUN}` }, slug: categorySlug },
    });
    expect(created.statusCode, created.body).toBe(201);
    const categoryId = (created.json() as { data: { id: string } }).data.id;
    for (const productId of [off.id, on.id]) {
      await em
        .getConnection()
        .execute(`insert into product_categories (product_id, category_id) values (?, ?) on conflict do nothing`, [
          productId,
          categoryId,
        ]);
    }
  }, 60_000);

  afterAll(async () => {
    if (!h) return;
    await clearProductScopes(h.em(), [off.id, on.id]);
    await teardownBackendServer(h);
  });

  it('the category block lists the available product and omits the switched-off one', async () => {
    const res = await h.app.inject({
      method: 'GET',
      url: `/api/v1/catalog/products?categorySlug=${categorySlug}&limit=12`,
      headers: CHANNEL,
    });
    expect(res.statusCode, res.body).toBe(200);
    const ids = (res.json() as { data: Array<{ id: string }> }).data.map((p) => p.id);
    expect(ids).toContain(on.id);
    expect(ids).not.toContain(off.id);
  });

  it('a block naming products by slug resolves the available one and 404s the switched-off one', async () => {
    const get = (sku: string) =>
      h.app.inject({ method: 'GET', url: `/api/v1/catalog/products/${sku.toLowerCase()}`, headers: CHANNEL });
    expect((await get(on.sku)).statusCode).toBe(200);
    expect((await get(off.sku)).statusCode).toBe(404);
  });
});

import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { CatalogueReferencePricePort } from '@endora-commerce/contracts';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../../helpers/test-server.js';
import { setupPricingFixture, type PricingFixture } from '../../../helpers/pricing-fixture.js';

/**
 * Spec 193 — the catalogue reference price of a designated book
 * (`specs/pricing/worked-examples.md` §10.21, vectors CR1–CR6; OQ-1 of
 * `specs/193-product-visibility-rules/`). The fixed profile `[base book, designated book]`:
 * the designated row wins, the base stands where it is silent, a book out of its window is
 * "not in force" at read time, variants answer one line each, and no sale book is read.
 */
describe('worked examples — catalogue reference price CR1–CR6 (spec 193)', () => {
  let h: BackendServerHandle;
  let f: PricingFixture;
  const port = () => (h.container as unknown as { resolve<T>(n: string): T }).resolve<CatalogueReferencePricePort>('catalogueReferencePricePort');
  const reference = async (bookId: string | null, productId: string) =>
    (
      await port().resolve({
        currencyCode: 'PLN',
        designation: bookId ? { priceListId: bookId, salesChannelId: f.channels.CH1.id } : null,
        productIds: [productId],
      })
    ).get(productId);

  beforeAll(async () => {
    h = await setupBackendServer();
    f = await setupPricingFixture(h);
  }, 5 * 60_000);

  afterEach(async () => {
    await f.clearBooks();
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('CR1, CR2 — the designated row wins; where it is silent the base stands', async () => {
    const d = await f.book({ audience: 'everyone', rows: [{ product: f.products.P1, fixed: '90' }] });
    expect(await reference(d.id, f.products.P1.id)).toEqual([{ variantId: null, amount: '90.0000' }]);
    expect(await reference(d.id, f.products.P2.id)).toEqual([{ variantId: null, amount: '50.0000' }]);
  });

  it('CR3 — out of its window the book is not in force; the resolution is unchanged', async () => {
    const d = await f.book({ audience: 'everyone', rows: [{ product: f.products.P1, fixed: '90' }] });
    await h
      .em()
      .getConnection()
      .execute(`update "price_lists" set "ends_at" = now() - interval '1 day' where "id" = ?`, [d.id]);
    expect(await port().designationStatus({ currencyCode: 'PLN', priceListId: d.id, salesChannelId: f.channels.CH1.id })).toMatchObject({
      inForce: false,
      reason: 'outside_schedule',
    });
    expect(await reference(d.id, f.products.P1.id)).toEqual([{ variantId: null, amount: '90.0000' }]);
  });

  it('CR4 — one line per variant; a variant the book is silent on keeps its base', async () => {
    const d = await f.book({ audience: 'everyone', rows: [{ product: f.products.P5, variant: f.variants.P5r, fixed: '70' }] });
    const lines = [...((await reference(d.id, f.products.P5.id)) ?? [])].sort((a, b) =>
      String(a.variantId).localeCompare(String(b.variantId)),
    );
    expect(lines).toEqual(
      [
        { variantId: f.variants.P5r, amount: '70.0000' },
        { variantId: f.variants.P5b, amount: '80.0000' },
      ].sort((a, b) => a.variantId.localeCompare(b.variantId)),
    );
  });

  it('CR5 — no designation: the base book alone', async () => {
    await f.book({ audience: 'everyone', rows: [{ product: f.products.P1, fixed: '90' }] });
    expect(await reference(null, f.products.P1.id)).toEqual([{ variantId: null, amount: '100.0000' }]);
  });

  it('CR6 — a sale for everyone on the channel is never in the profile', async () => {
    const d = await f.book({ audience: 'everyone', rows: [{ product: f.products.P1, fixed: '90' }] });
    await f.book({ type: 'sale', audience: 'everyone', rows: [{ percent: '-50' }] });
    expect(await reference(d.id, f.products.P1.id)).toEqual([{ variantId: null, amount: '90.0000' }]);
    expect(await f.amount('guest', f.products.P1)).toBe('45.0000');
  });
});

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { CatalogueReferencePricePort } from '@endora-commerce/contracts';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { setupPricingFixture, type PricingFixture } from '../../helpers/pricing-fixture.js';
import {
  presetConfig,
  type PresetName,
} from '../../../../packages/modules/price_lists/src/backend/services/precedence.js';

/**
 * Spec 193 (`specs/193-product-visibility-rules/` research R-4, T010) — the catalogue
 * reference price owes the identity test every resolution path owes (`pricing.md`): for a
 * channel whose only everyone book is the designated one, `catalogueReferencePricePort.resolve`
 * equals `resolveLinePrices` for a guest on that channel, at quantity 1, line by line —
 * variants included — under every precedence preset. Undesignated, it equals the guest
 * price on a channel with no everyone book: the base book.
 */
const PRESETS: PresetName[] = ['AF', 'SF', 'HY', 'AF-N'];

describe('catalogue reference price ≡ the guest line price (spec 193, R-4)', () => {
  let h: BackendServerHandle;
  let f: PricingFixture;
  let designatedId: string;
  const sql = (statement: string, params: unknown[] = []) => h.em().getConnection().execute(statement, params);
  const port = () => (h.container as unknown as { resolve<T>(n: string): T }).resolve<CatalogueReferencePricePort>('catalogueReferencePricePort');

  beforeAll(async () => {
    h = await setupBackendServer();
    f = await setupPricingFixture(h);
    // CH1's only everyone book: every selection kind, so the presets order something.
    const designated = await f.book({
      name: 'Designated catalogue',
      audience: 'everyone',
      rows: [
        { category: f.categories.screws, attribute: ['color', 'red'], fixed: '120' },
        { category: f.categories.screws, fixed: '110' },
        { attribute: ['color', 'red'], percent: '20' },
        { product: f.products.P2, percent: '-10' },
        { product: f.products.P5, variant: f.variants.P5r, fixed: '70' },
      ],
    });
    designatedId = designated.id;
    // Books that must not move a catalogue reference: a buyer book on CH1 and an
    // everyone book and a sale on CH2 (CH2 is where the base book is compared).
    await f.book({ audience: { organizations: [f.orgs.Acme] }, rows: [{ percent: '-50' }] });
    await f.book({ audience: 'everyone', channels: [f.channels.CH3], currency: 'EUR', rows: [{ percent: '-50' }] });
  }, 5 * 60_000);

  afterAll(async () => {
    await sql(`delete from "price_list_precedence" where "version" = 2`);
    await sql(`update "price_list_precedence" set "state" = 'active' where "version" = 1`);
    await teardownBackendServer(h);
  });

  async function switchPreset(preset: PresetName): Promise<void> {
    await sql(`delete from "price_list_precedence" where "version" = 2`);
    if (preset === 'HY') {
      await sql(`update "price_list_precedence" set "state" = 'active' where "version" = 1`);
      return;
    }
    const config = presetConfig(preset);
    await sql(`update "price_list_precedence" set "state" = 'superseded' where "version" = 1`);
    await sql(
      `insert into "price_list_precedence" ("version", "cells", "category_before_attribute", "depth_mode", "state", "created_at", "activated_at")
       values (2, ?::jsonb, ?, ?, 'active', now(), now())`,
      [JSON.stringify(config.cells), config.categoryBeforeAttribute, config.depthMode],
    );
  }

  const variantsOf = (productId: string): string[] =>
    productId === f.products.P5.id ? [f.variants.P5r, f.variants.P5b] : [];

  async function expectIdentity(designation: { priceListId: string; salesChannelId: string } | null, guestChannel: typeof f.channels.CH1) {
    const products = Object.values(f.products);
    const reference = await port().resolve({ currencyCode: 'PLN', designation, productIds: products.map((p) => p.id) });
    for (const product of products) {
      const variants = variantsOf(product.id);
      const expected = await Promise.all(
        (variants.length > 0 ? variants : [null]).map(async (variantId) => ({
          variantId,
          amount: await f.amount('guest', product, { variantId, channel: guestChannel }),
        })),
      );
      // Line order is catalog's variant order; the identity is per line.
      const byVariant = (a: { variantId: string | null }, b: { variantId: string | null }) =>
        String(a.variantId).localeCompare(String(b.variantId));
      expect([...(reference.get(product.id) ?? [])].sort(byVariant), product.sku).toEqual(expected.sort(byVariant));
    }
  }

  for (const preset of PRESETS) {
    it(`${preset} — designated: every line equals the guest price on the designated book's channel`, async () => {
      await switchPreset(preset);
      await expectIdentity({ priceListId: designatedId, salesChannelId: f.channels.CH1.id }, f.channels.CH1);
    });

    it(`${preset} — undesignated: every line equals the base book`, async () => {
      await switchPreset(preset);
      await expectIdentity(null, f.channels.CH2);
    });
  }

  it('the designated book actually moves something (the identity is not vacuous)', async () => {
    await switchPreset('HY');
    const designated = await port().resolve({
      currencyCode: 'PLN',
      designation: { priceListId: designatedId, salesChannelId: f.channels.CH1.id },
      productIds: [f.products.P1.id, f.products.P2.id],
    });
    const base = await port().resolve({ currencyCode: 'PLN', designation: null, productIds: [f.products.P1.id, f.products.P2.id] });
    expect(designated.get(f.products.P1.id)).not.toEqual(base.get(f.products.P1.id));
    expect(designated.get(f.products.P2.id)).toEqual([{ variantId: null, amount: '45.0000' }]);
    expect(base.get(f.products.P2.id)).toEqual([{ variantId: null, amount: '50.0000' }]);
  });

  it('an unpriced product answers a null line; a product that does not exist is absent', async () => {
    const missing = '00000000-0000-4000-8000-000000000193';
    const out = await port().resolve({ currencyCode: 'PLN', designation: null, productIds: [f.products.P4.id, missing] });
    expect(out.get(f.products.P4.id)).toEqual([{ variantId: null, amount: null }]);
    expect(out.has(missing)).toBe(false);
  });
});

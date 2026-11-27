import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { CATALOGUE_PRICES_CHANGED_EVENT } from '@endora-commerce/contracts';
import { setupBackendServer, teardownBackendServer, type BackendServerHandle } from '../../helpers/test-server.js';
import { setupPricingFixture, type PricingFixture } from '../../helpers/pricing-fixture.js';
import { clearConfiguration, clearFlags, flagsOf, settleFlags, waitForMark } from './fixtures.js';

/**
 * Spec 193 Phase 4 (T029) — `price_lists.catalogue_prices_changed` drives the flags (research R-6;
 * threat model TM-12, TM-7 (5)). A targeted price change marks its products and is reflected
 * after one pass (FR-062: ≤ 60 s); a catalogue-wide change asks for a whole rebuild; a book that is
 * neither the base book nor a designated one moves nothing; and an announcement that is malformed,
 * oversized or spoofed only ever asks for a rebuild — no flag value is taken from it.
 */
describe('catalogue-price flags — the change feed (spec 193, T029)', () => {
  let h: BackendServerHandle;
  let f: PricingFixture;
  const sql = <T>(s: string, p: unknown[] = []) => h.em().getConnection().execute<T[]>(s, p);
  const wholeStale = async () =>
    (await sql<{ currency_code: string }>(`select "currency_code" from "catalogue_price_generations" where "whole_stale" order by 1`)).map((r) =>
      r.currency_code.trim(),
    );
  const marks = async () => (await sql<{ n: number }>(`select count(*)::int as n from "catalogue_price_stale_products"`))[0]!.n;
  const positive = async (productId: string) =>
    (
      await sql<{ has_positive: boolean }>(
        `select p."has_positive" from "product_catalogue_prices" p join "catalogue_price_generations" g
            on g."currency_code" = p."currency_code" and g."served_generation" = p."generation"
          where p."currency_code" = 'PLN' and p."product_id" = ?`,
        [productId],
      )
    )[0]?.has_positive ?? null;
  /** Emit as anyone could — the bus does not check who emits (TM-12) — and let the handler run. */
  const emit = async (payload: unknown) => {
    h.eventBus.emit(CATALOGUE_PRICES_CHANGED_EVENT as never, payload as never);
    await new Promise((resolve) => setTimeout(resolve, 300));
  };

  beforeAll(async () => {
    h = await setupBackendServer();
    f = await setupPricingFixture(h);
    await clearConfiguration(h);
    await clearFlags(h);
    await flagsOf(h).requestRebuild(['PLN', 'EUR']);
    await settleFlags(h);
  }, 5 * 60_000);

  beforeEach(async () => {
    await settleFlags(h);
  });

  afterAll(async () => {
    await clearFlags(h);
    await f.clearBooks();
    await f.resetBase();
    await teardownBackendServer(h);
  });

  it('a base price change marks the product and one pass reflects it (FR-062)', async () => {
    expect(await positive(f.products.P2.id)).toBe(true);
    await f.setBase(f.products.P2, { product: [{ minQuantity: 1, maxQuantity: null, amount: '0' }], variants: {} });
    await waitForMark(h, f.products.P2.id);
    expect(await wholeStale()).toEqual([]);
    const started = Date.now();
    await flagsOf(h).runPass();
    expect(Date.now() - started).toBeLessThan(60_000);
    expect(await positive(f.products.P2.id)).toBe(false);
    await f.resetBase();
  });

  it('a catalogue-wide change asks for a whole rebuild; a book that prices no catalogue reference moves nothing', async () => {
    await emit({ eventId: 'e1', occurredAt: new Date().toISOString(), change: { kind: 'categories', categoryIds: [f.categories.screws] } });
    expect(await wholeStale()).toEqual(['EUR', 'PLN']);
    await settleFlags(h);
    await f.book({ audience: { organizations: [f.orgs.Acme] }, rows: [{ product: f.products.P1, fixed: '1' }] });
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(await wholeStale()).toEqual([]);
    expect(await marks()).toBe(0);
  });

  it('malformed, oversized or spoofed announcements only ask for a rebuild — never a flag value (TM-12)', async () => {
    const before = await positive(f.products.P1.id);
    await emit({ change: { kind: 'products', productIds: 'everything' }, hasPositive: false });
    expect(await wholeStale()).toEqual(['EUR', 'PLN']);
    expect(await positive(f.products.P1.id)).toBe(before);
    await settleFlags(h);

    const many = Array.from({ length: 1_001 }, () => randomUUID());
    await emit({ eventId: 'e2', occurredAt: new Date().toISOString(), change: { kind: 'products', productIds: many, currencyCodes: ['PLN'] } });
    expect(await wholeStale()).toEqual(['PLN']);
    expect(await marks()).toBe(0);
    await settleFlags(h);

    // A spoofed "this product is free" names a product; it is re-resolved from the engine, not believed.
    await emit({
      eventId: 'e3',
      occurredAt: new Date().toISOString(),
      change: { kind: 'books', books: [{ bookId: randomUUID(), currencyCodes: ['PLN'], isSystem: true, productIds: [f.products.P1.id] }] },
    });
    expect(await marks()).toBe(1);
    await settleFlags(h);
    expect(await positive(f.products.P1.id)).toBe(before);
  });
});

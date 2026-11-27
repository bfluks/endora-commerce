import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { encodeCursor } from '@endora-commerce/platform/http';
import {
  PRICE_WALK_CURSOR_PURPOSE,
  type CatalogCursorSeal,
} from '../../../../packages/modules/catalog/src/backend/services/catalog-query.service.js';
import { settlePriceSurface, warmPriceSort } from '../../helpers/price-surface.js';
import {
  PRICE_WALK_CHANNEL,
  PRICE_WALK_ORG_A,
  PRICE_WALK_PREFIX,
  priceWalkCorpus,
  type PriceWalkItem,
} from '../../helpers/price-walk-corpus.js';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';

/**
 * Review 3 of release 0.108.0, part A — a price-sorted walk pages through the
 * catalogue to its end, whatever happens to its price order on the way.
 *
 * Keyset pagination over a live price promises nothing about a product whose
 * price changes during the walk: it may be met twice or not at all, as on any
 * keyset walk over a mutable key. Every other product is met exactly once —
 * when the price order goes missing midway, when a page runs out of its scan
 * budget, and on a cursor issued before any of that happened.
 *
 * A fourth case — a walk on a channel that published no prices (A3) — went
 * with the channel's price-visibility flag (issue #492): no channel withholds
 * prices from the walk any more, and a viewer whose display mode is `none` is
 * refused a price ordering by the route before any walk starts.
 */
describe('a price-sorted walk meets every product once and ends', () => {
  let h: BackendServerHandle;
  let w: ReturnType<typeof priceWalkCorpus>;

  beforeAll(async () => {
    h = await setupBackendServer();
    w = priceWalkCorpus(h);
    await w.init();
  }, 60_000);

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  // ---- a scan budget never ends a walk ----------------------------------------

  it('a remainder page that runs out of its scan budget hands on a cursor rather than ending the walk', async () => {
    // Cheapest is newest, so the default order the remainder walks meets the
    // ten products already served first: more than a page's budget (8 rows).
    const items = w.priced(14, (i) => ({ price: `${100 + i}.00`, age: i }));
    await w.seed(items);
    const { skus, ended } = await w.walk({ sort: 'price', limit: 1, between: w.dropOnceAt(10) });
    expect(ended).toBe(true);
    expect(skus.slice(0, 10)).toEqual(items.slice(0, 10).map((i) => w.skuOf(i.key)));
    expect([...skus].sort()).toEqual(w.visibleSkus(items).sort());
  });

  it('a priced or tail page that runs out of its scan budget hands on a cursor rather than ending the walk', async () => {
    const items: PriceWalkItem[] = [
      // Ten hidden products lead the price order, ten hidden unpriced ones lead the tail.
      ...w.priced(10, (i) => ({ price: `${10 + i}.00`, age: 100 + i }), 'HP').map((i) => ({ ...i, hidden: true })),
      ...w.priced(3, (i) => ({ price: `${50 + i}.00`, age: 200 + i }), 'VP'),
      ...Array.from({ length: 10 }, (_, i): PriceWalkItem => ({ key: `HU${i}`, price: null, hidden: true, age: i })),
      ...Array.from({ length: 2 }, (_, i): PriceWalkItem => ({ key: `VU${i}`, price: null, age: 50 + i })),
    ];
    await w.seed(items);
    for (const sort of ['price', '-price'] as const) {
      const { skus, ended } = await w.walk({ sort, limit: 1 });
      expect(ended, sort).toBe(true);
      expect([...skus].sort(), sort).toEqual(w.visibleSkus(items).sort());
      expect(skus.slice(-2), `${sort}: the unpriced come last`).toEqual([w.skuOf('VU0'), w.skuOf('VU1')]);
    }
  });

  it('a price-filtered page that runs out of its scan budget hands on a cursor rather than ending the walk', async () => {
    // Ten products outside the range lead the default order.
    const items: PriceWalkItem[] = [
      ...w.priced(10, (i) => ({ price: `${500 + i}.00`, age: i }), 'OUT'),
      ...w.priced(3, (i) => ({ price: `${100 + i}.00`, age: 20 + i }), 'IN'),
    ];
    await w.seed(items);
    const { skus, ended } = await w.walk({ limit: 1, query: '&maxPrice=200' });
    expect(ended).toBe(true);
    expect([...skus].sort()).toEqual(['IN00', 'IN01', 'IN02'].map(w.skuOf));
  });

  it('a long walk whose price order goes missing at 90 % ends and meets every product once', async () => {
    // A default order unrelated to the price order, three hidden priced
    // products among the visible ones, four unpriced.
    const items: PriceWalkItem[] = [
      ...w.priced(30, (i) => ({ price: `${100 + 2 * i}.00`, age: (i * 7) % 30 })),
      ...w.priced(3, (i) => ({ price: `${101 + 20 * i}.00`, age: 40 + i }), 'H').map((i) => ({ ...i, hidden: true })),
      ...Array.from({ length: 4 }, (_, i): PriceWalkItem => ({ key: `U${i}`, price: null, age: 10 + 3 * i })),
    ];
    for (const sort of ['price', '-price'] as const) {
      for (const limit of [1, 3]) {
        await w.seed(items);
        const { skus, ended } = await w.walk({ sort, limit, between: w.dropOnceAt(30) });
        expect(ended, `${sort}, limit ${limit}`).toBe(true);
        expect([...skus].sort(), `${sort}, limit ${limit}`).toEqual(w.visibleSkus(items).sort());
      }
    }
  });

  // ---- a malformed cursor is discarded, never a 500 ---------------------------
  //
  // Sealed as the walk seals its own (issue #497), so each case reaches the
  // field it names: an unsealed one is discarded before any field is read
  // (`price-cursor-sealed.test.ts`).
  const sealed = (payload: unknown): string =>
    (h.container as unknown as { resolve<T>(name: string): T })
      .resolve<CatalogCursorSeal>('cursorSeal')
      .seal(PRICE_WALK_CURSOR_PURPOSE, JSON.stringify(payload));

  const someId = '00000000-0000-4000-8000-000000000001';
  const at = '2026-03-01T00:00:00.000Z';

  it.each([
    ['a priced cursor with a malformed amount', { stream: 'priced', amount: 'abc', productId: someId }],
    ['a priced cursor with an old-format amount', { stream: 'priced', amount: '100.00001', productId: someId }],
    ['a priced cursor with a numeric amount', { stream: 'priced', amount: 100, productId: someId }],
    ['a priced cursor with a malformed product id', { stream: 'priced', amount: '100.0000', productId: 'nope' }],
    ['a tail cursor with a malformed date', { stream: 'tail', createdAt: 'yesterday', id: someId }],
    ['a tail cursor with a malformed id', { stream: 'tail', createdAt: at, id: 'nope' }],
    ['a rest cursor with a malformed amount', { stream: 'rest', amount: '1e5', productId: someId, after: { createdAt: at, id: someId } }],
    ['a rest cursor with no position', { stream: 'rest', amount: '100.0000', productId: someId, after: null }],
    ['a rest cursor with a malformed position', { stream: 'rest', amount: '100.0000', productId: someId, after: { createdAt: 'x', id: someId } }],
    ['a rest cursor with a malformed position id', { stream: 'rest', amount: '100.0000', productId: someId, after: { createdAt: at, id: 'nope' } }],
    ['an unordered cursor wrapping garbage', { stream: 'unordered', cursor: 'not-a-cursor' }],
    ['an unordered cursor wrapping a number', { stream: 'unordered', cursor: 7 }],
  ])('%s is discarded: the first page, not a 500', async (_name, payload) => {
    await w.seed(w.priced(4, (i) => ({ price: `${100 + i}.00`, age: i })));
    const first = await w.page('&limit=2&sort=price');
    const again = await w.page(`&limit=2&sort=price&cursor=${encodeURIComponent(sealed(payload))}`);
    expect(again.data.map((d) => d.sku)).toEqual(first.data.map((d) => d.sku));
  });

  it('a default-listing cursor with a malformed id is discarded too: the first page, not a 500', async () => {
    await w.seed(w.priced(4, (i) => ({ price: `${100 + i}.00`, age: i })));
    const first = await w.page('&limit=2');
    const again = await w.page(`&limit=2&cursor=${encodeURIComponent(encodeCursor(JSON.stringify({ createdAt: at, id: 'nope' })))}`);
    expect(again.data.map((d) => d.sku)).toEqual(first.data.map((d) => d.sku));
  });

  // ---- prices that change, and cursors issued before they did ---------------

  it('a long walk repriced while its order goes missing meets every product it did not reprice exactly once', async () => {
    const items: PriceWalkItem[] = [
      ...w.priced(30, (i) => ({ price: `${100 + 2 * i}.00`, age: (i * 7) % 30 })),
      ...Array.from({ length: 4 }, (_, i): PriceWalkItem => ({ key: `U${i}`, price: null, age: 10 + 3 * i })),
    ];
    for (const sort of ['price', '-price'] as const) {
      await w.seed(items);
      // At 90 %: the first product served moves to the far end of the order,
      // and a product not served yet moves to its start. Then the order goes.
      const [first, last] = sort === 'price' ? ['P00', 'P29'] : ['P29', 'P00'];
      const { skus, ended } = await w.walk({
        sort,
        limit: 3,
        between: w.dropOnceAt(27, async () => {
          await w.reprice(first, sort === 'price' ? '999.00' : '1.00');
          await w.reprice(last, sort === 'price' ? '1.00' : '999.00');
        }),
      });
      expect(ended, sort).toBe(true);
      const seen = w.counts(skus);
      for (const sku of w.visibleSkus(items)) {
        if (sku === w.skuOf(first) || sku === w.skuOf(last)) continue;
        expect(seen.get(sku), `${sort}: ${sku}`).toBe(1);
      }
    }
  });

  it('a remainder cursor stays a remainder walk after the price order is rebuilt, and meets every product once', async () => {
    const items: PriceWalkItem[] = [
      ...w.priced(10, (i) => ({ price: `${100 + i}.00`, age: (i * 3) % 10 })),
      { key: 'U0', price: null, age: 4 },
    ];
    await w.seed(items);
    let pages = 0;
    const { skus, ended } = await w.walk({
      sort: 'price',
      limit: 2,
      between: async () => {
        pages += 1;
        if (pages === 2) await w.dropRetailProfiles();
        // The order is back two pages later; the walk holds a remainder cursor by then.
        if (pages === 4) await warmPriceSort(h, [{ headers: PRICE_WALK_CHANNEL }]);
      },
    });
    expect(ended).toBe(true);
    expect([...skus].sort()).toEqual(w.visibleSkus(items).sort());
  });

  it('a priced cursor whose boundary product was repriced and the order rebuilt meets every other product once', async () => {
    const items = w.priced(10, (i) => ({ price: `${100 + i}.00`, age: (i * 3) % 10 }));
    await w.seed(items);
    const first = await w.page('&limit=3&sort=price');
    const boundary = first.data[first.data.length - 1]!.sku.slice(PRICE_WALK_PREFIX.length);
    await w.reprice(boundary, '1.00');
    await settlePriceSurface(h);
    const { skus, ended } = await w.walk({ sort: 'price', limit: 3, start: first.pagination.cursor! });
    expect(ended).toBe(true);
    const seen = w.counts([...first.data.map((d) => d.sku), ...skus]);
    for (const sku of w.visibleSkus(items)) if (sku !== w.skuOf(boundary)) expect(seen.get(sku), sku).toBe(1);
  });

  // ---- the viewer's pricing context is built once per page ------------------

  it('a remainder page resolves the viewer organization once, however many chunks it reads', async () => {
    // Cheapest is newest: the remainder after ten served products scans them
    // first, four chunks of two at a page of one.
    await w.seed(
      w.priced(14, (i) => ({ price: `${100 + i}.00`, age: i })),
      [PRICE_WALK_ORG_A],
    );
    let cursor: string | undefined;
    for (let n = 0; n < 10; n += 1) {
      const body = await w.page(`&limit=1&sort=price${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`, PRICE_WALK_ORG_A);
      cursor = body.pagination.cursor!;
    }
    await w.dropRetailProfiles();
    const organizations = (h.container as unknown as { resolve<T>(name: string): T }).resolve<{
      findById(id: string): Promise<unknown>;
    }>('organizationDetailsPort');
    const spy = vi.spyOn(organizations, 'findById');
    try {
      await w.page(`&limit=1&sort=price&cursor=${encodeURIComponent(cursor!)}`, PRICE_WALK_ORG_A);
      expect(spy.mock.calls.length).toBeLessThanOrEqual(1);
    } finally {
      spy.mockRestore();
    }
  });
});

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { encodeCursor } from '@endora-commerce/platform/http';
import {
  PRICE_RANGE_WALK_CURSOR_PURPOSE,
  PRICE_WALK_CURSOR_PURPOSE,
} from '../../../../packages/modules/catalog/src/backend/services/catalog-query.service.js';
import { priceWalkCorpus, type PriceWalkItem } from '../../helpers/price-walk-corpus.js';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';

/**
 * Issue #497 — a cursor a price walk hands a client says nothing about a
 * product the client may not see, or whose price it may not learn.
 *
 * A page cut by its scan budget continues from where its scan stopped (review 3
 * of release 0.108.0, A1), and that position can be a product the viewer may
 * not see; under a price sort the position holds the product's resolved price
 * and id. A full page ends on its last card, whose price the viewer's display
 * mode may withhold. Both were base64 of JSON. Every cursor a price walk issues
 * is now sealed: it decodes to nothing, a cursor of the old format starts the
 * walk again, and the walk still meets every product it shows exactly once.
 */
describe('a price walk cursor reveals nothing of a product the viewer may not see (#497)', () => {
  let h: BackendServerHandle;
  let w: ReturnType<typeof priceWalkCorpus>;

  beforeAll(async () => {
    h = await setupBackendServer();
    w = priceWalkCorpus(h);
    await w.init();
  }, 60_000);

  afterAll(async () => {
    await w.clear();
    await teardownBackendServer(h);
  });

  /** Everything a client can read off a cursor: the token, and what base64 makes of it. */
  const readable = (cursor: string): string =>
    [cursor, Buffer.from(cursor, 'base64url').toString('utf8'), Buffer.from(cursor, 'base64').toString('utf8')].join('\n');

  /** Walks the listing, collecting every cursor it is handed. */
  async function walkCollecting(options: Parameters<typeof w.walk>[0]) {
    const cursors: string[] = [];
    const result = await w.walk({
      ...options,
      between: async (served, cursor) => {
        cursors.push(cursor);
        await options.between?.(served, cursor);
      },
    });
    return { ...result, cursors };
  }

  function expectNothingOf(cursors: readonly string[], products: ReadonlyArray<{ key: string; amount?: string }>, label: string): void {
    expect(cursors.length, `${label}: the walk handed on cursors`).toBeGreaterThan(0);
    for (const cursor of cursors) {
      const text = readable(cursor);
      for (const p of products) {
        expect(text, `${label}: the id of ${p.key}`).not.toContain(w.idOf(p.key));
        if (p.amount !== undefined) expect(text, `${label}: the price of ${p.key}`).not.toContain(p.amount);
      }
    }
    for (const cursor of cursors) {
      expect(() => JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')), `${label}: a cursor is not JSON`).toThrow();
    }
  }

  const hidden = (items: readonly PriceWalkItem[]) =>
    items.filter((i) => i.hidden).map((i) => ({ key: i.key, ...(i.price !== null ? { amount: i.price } : {}) }));

  it('a page cut by its scan budget on a hidden product hands on a cursor without its price or id, in both directions', async () => {
    const items: PriceWalkItem[] = [
      // Ten hidden products lead the price order, ten hidden unpriced ones lead the tail.
      ...w.priced(10, (i) => ({ price: `${10 + i}.00`, age: 100 + i }), 'HP').map((i) => ({ ...i, hidden: true })),
      ...w.priced(3, (i) => ({ price: `${50 + i}.00`, age: 200 + i }), 'VP'),
      ...Array.from({ length: 10 }, (_, i): PriceWalkItem => ({ key: `HU${i}`, price: null, hidden: true, age: i })),
      ...Array.from({ length: 2 }, (_, i): PriceWalkItem => ({ key: `VU${i}`, price: null, age: 50 + i })),
    ];
    await w.seed(items);

    // The first ascending page reads eight hidden products and stops on one.
    const first = await w.page('&limit=1&sort=price');
    expect(first.data, 'the budget bound before a visible product').toEqual([]);
    expect(first.pagination.hasMore).toBe(true);
    expectNothingOf([first.pagination.cursor!], hidden(items), 'the first page');

    for (const sort of ['price', '-price'] as const) {
      const { skus, ended, cursors } = await walkCollecting({ sort, limit: 1 });
      expect(ended, sort).toBe(true);
      expect([...w.counts(skus).entries()].sort(), sort).toEqual(w.visibleSkus(items).sort().map((s) => [s, 1]));
      expectNothingOf(cursors, hidden(items), sort);
    }
  });

  it('a price-filtered page cut by its scan budget on a hidden product hands on a cursor without its id', async () => {
    const items: PriceWalkItem[] = [
      // Ten hidden products inside the range lead the default order.
      ...w.priced(10, (i) => ({ price: `${110 + i}.00`, age: i }), 'HP').map((i) => ({ ...i, hidden: true })),
      ...w.priced(3, (i) => ({ price: `${150 + i}.00`, age: 20 + i }), 'IN'),
    ];
    await w.seed(items);
    for (const query of ['&maxPrice=200', '&maxPrice=200&sort=name']) {
      const { skus, ended, cursors } = await walkCollecting({ limit: 1, query });
      expect(ended, query).toBe(true);
      expect([...skus].sort(), query).toEqual(w.visibleSkus(items).sort());
      expectNothingOf(cursors, hidden(items), query);
    }
  });

  it('a walk whose price order goes missing on a hidden product carries on without its price or id', async () => {
    const items: PriceWalkItem[] = [
      ...w.priced(10, (i) => ({ price: `${10 + i}.00`, age: 100 + i }), 'HP').map((i) => ({ ...i, hidden: true })),
      ...w.priced(4, (i) => ({ price: `${50 + i}.00`, age: (i * 3) % 4 }), 'VP'),
      { key: 'VU0', price: null, age: 2 },
    ];
    for (const sort of ['price', '-price'] as const) {
      await w.seed(items);
      // The first page stops on a hidden product; the order goes before the second.
      const { skus, ended, cursors } = await walkCollecting({ sort, limit: 1, between: w.dropOnceAt(0) });
      expect(ended, sort).toBe(true);
      expect([...skus].sort(), sort).toEqual(w.visibleSkus(items).sort());
      expectNothingOf(cursors, hidden(items), sort);
    }
  });

  it('a page that ends on a product whose price is withheld hands on a cursor without that price', async () => {
    const items = w.priced(6, (i) => ({ price: `${100 + i}.00`, age: i }));
    await w.seed(items);
    // Withheld for every viewer, while the price order still ranks it by the
    // price it had (the worker has not refreshed it yet).
    await w.withhold('P02');
    for (const sort of ['price', '-price'] as const) {
      const cursors: string[] = [];
      const skus: string[] = [];
      let cursor: string | undefined;
      for (let n = 0; n < 20; n += 1) {
        const body = await w.page(`&limit=1&sort=${sort}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`);
        for (const card of body.data) {
          skus.push(card.sku);
          if (card.sku === w.skuOf('P02')) expect(card.price, `${sort}: P02's card`).toBeNull();
        }
        if (!body.pagination.hasMore) break;
        cursor = body.pagination.cursor!;
        cursors.push(cursor);
      }
      expect(skus, `${sort}: the walk served P02`).toContain(w.skuOf('P02'));
      const seen = w.counts(skus);
      for (const key of ['P00', 'P01', 'P03', 'P04', 'P05']) expect(seen.get(w.skuOf(key)), `${sort}: ${key}`).toBe(1);
      expectNothingOf(cursors, [{ key: 'P02', amount: '102.00' }], sort);
    }
  });

  // ---- cursors issued before the seal, and cursors altered ----------------------

  it('a price cursor of the old, readable format starts the walk again rather than continuing it', async () => {
    const items = w.priced(4, (i) => ({ price: `${100 + i}.00`, age: i }));
    await w.seed(items);
    const first = await w.page('&limit=2&sort=price');
    expect(first.data.map((d) => d.sku)).toEqual(['P00', 'P01'].map(w.skuOf));
    for (const legacy of [
      { stream: 'priced', amount: '101.0000', productId: w.idOf('P01') },
      { stream: 'tail', createdAt: '2026-03-01T00:00:00.000Z', id: w.idOf('P01') },
    ]) {
      const again = await w.page(`&limit=2&sort=price&cursor=${encodeURIComponent(encodeCursor(JSON.stringify(legacy)))}`);
      expect(again.data.map((d) => d.sku), legacy.stream).toEqual(first.data.map((d) => d.sku));
    }
  });

  it('a price-filtered cursor of the old, readable format starts the walk again', async () => {
    await w.seed(w.priced(4, (i) => ({ price: `${100 + i}.00`, age: i })));
    const first = await w.page('&limit=2&maxPrice=200');
    const legacy = encodeCursor(JSON.stringify({ createdAt: '2026-02-28T23:59:00.000Z', id: w.idOf('P01') }));
    const again = await w.page(`&limit=2&maxPrice=200&cursor=${encodeURIComponent(legacy)}`);
    expect(again.data.map((d) => d.sku)).toEqual(first.data.map((d) => d.sku));
  });

  it('an altered cursor, or one sealed for the other price walk, starts the walk again', async () => {
    await w.seed(w.priced(6, (i) => ({ price: `${100 + i}.00`, age: i })));
    const first = await w.page('&limit=2&sort=price');
    const issued = first.pagination.cursor!;
    // One position, one cursor: a storefront's next-page link is one URL.
    expect((await w.page('&limit=2&sort=price')).pagination.cursor).toBe(issued);
    const bytes = Buffer.from(issued, 'base64url');
    bytes[bytes.length - 1] = bytes[bytes.length - 1]! ^ 0x01;
    const seal = (h.container as unknown as { resolve<T>(name: string): T }).resolve<{
      seal(purpose: string, payload: string): string;
    }>('cursorSeal');
    const second = await w.page(`&limit=2&sort=price&cursor=${encodeURIComponent(issued)}`);
    expect(second.data.map((d) => d.sku)).toEqual(['P02', 'P03'].map(w.skuOf));
    for (const [label, cursor] of [
      ['altered', bytes.toString('base64url')],
      ['sealed for the range walk', seal.seal(PRICE_RANGE_WALK_CURSOR_PURPOSE, JSON.stringify({ stream: 'priced', amount: '101.0000', productId: w.idOf('P01') }))],
    ] as const) {
      const again = await w.page(`&limit=2&sort=price&cursor=${encodeURIComponent(cursor)}`);
      expect(again.data.map((d) => d.sku), label).toEqual(first.data.map((d) => d.sku));
    }
    // …and one sealed for this walk is read: the purpose is the only difference.
    const sealed = seal.seal(PRICE_WALK_CURSOR_PURPOSE, JSON.stringify({ stream: 'priced', amount: '101.0000', productId: w.idOf('P01') }));
    const continued = await w.page(`&limit=2&sort=price&cursor=${encodeURIComponent(sealed)}`);
    expect(continued.data.map((d) => d.sku)).toEqual(['P02', 'P03'].map(w.skuOf));
  });
});

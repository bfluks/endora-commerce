import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  CATALOGUE_PRICES_CHANGED_EVENT,
  CataloguePricesChangedEventSchema,
  type CatalogueReferencePricePort,
  type CataloguePricesChangedEvent,
} from '@endora-commerce/contracts';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { setupPricingFixture, type PricingFixture } from '../../helpers/pricing-fixture.js';

/**
 * Spec 193 (`specs/193-product-visibility-rules/` contracts/events-and-errors.md §1, R-6,
 * T014) — `price_lists.catalogue_prices_changed`: emitted once per pricing-generation bump
 * by the writing process, after commit, carrying the bump's `SurfaceChange` in names-only
 * form; a change that moves nothing the surface stores (`{ kind: 'none' }`) is not emitted.
 * The status sweep's flip emits too. Every emission moves the change watermark.
 */
describe('price_lists.catalogue_prices_changed (spec 193, R-6)', () => {
  let h: BackendServerHandle;
  let f: PricingFixture;
  let events: CataloguePricesChangedEvent[] = [];
  let off: () => void;
  const port = () => (h.container as unknown as { resolve<T>(n: string): T }).resolve<CatalogueReferencePricePort>('catalogueReferencePricePort');
  const worker = () =>
    (h.container as unknown as { resolve<T>(name: string): T }).resolve<{
      handle: { statusWorker: { sweep(now: Date): Promise<{ scheduledToActive: number; activeToExpired: number }> } };
    }>('priceLists').handle.statusWorker;

  beforeAll(async () => {
    h = await setupBackendServer();
    f = await setupPricingFixture(h);
    off = h.eventBus.on(CATALOGUE_PRICES_CHANGED_EVENT as never, ((payload: CataloguePricesChangedEvent) => {
      events.push(payload);
    }) as never);
  }, 5 * 60_000);

  afterEach(() => {
    events = [];
  });

  afterAll(async () => {
    off();
    await f.clearBooks();
    await teardownBackendServer(h);
  });

  it('a book row write emits once, naming the book, its currency and the products of its rows', async () => {
    const book = await f.system(() =>
      f.books.createBook({
        name: 'Event book',
        type: 'regular',
        currencyCode: 'PLN',
        channelIds: [f.channels.CH1.id],
        audience: { kind: 'everyone', memberIds: [] },
        priority: 0,
      }),
    );
    // A new book is a draft: it moves nothing, so nothing is emitted.
    expect(events).toEqual([]);
    await f.system(() => f.books.activate(book.id));
    events = [];
    await f.system(() =>
      f.books.replaceRows(book.id, {
        upsert: [{ selection: { productId: f.products.P1.id }, minQuantity: 1, maxQuantity: null, price: { type: 'fixed', amount: '99' } }],
        delete: [],
      }),
    );
    expect(events).toHaveLength(1);
    const event = CataloguePricesChangedEventSchema.parse(events[0]);
    expect(event.change).toEqual({
      kind: 'books',
      books: [{ bookId: book.id, currencyCodes: ['PLN'], isSystem: false, productIds: [f.products.P1.id] }],
    });
    // Names only: nothing in the payload is an amount.
    expect(JSON.stringify(event)).not.toContain('99');
  });

  it('a base price write emits a products change', async () => {
    await f.setBase(f.products.P2, { product: [{ minQuantity: 1, maxQuantity: null, amount: '51' }], variants: {} });
    expect(events).toHaveLength(1);
    const { change } = CataloguePricesChangedEventSchema.parse(events[0]);
    expect(change.kind === 'books' || change.kind === 'products').toBe(true);
    const named = change.kind === 'books' ? change.books.flatMap((b) => b.productIds ?? []) : change.kind === 'products' ? change.productIds : [];
    expect(named).toContain(f.products.P2.id);
    await f.resetBase();
  });

  it('the status sweep’s flip emits; a sweep with nothing due emits nothing', async () => {
    const startsAt = new Date(Date.now() + 60_000);
    await f.book({ audience: 'everyone', rows: [{ product: f.products.P3, fixed: '29' }], startsAt });
    events = [];
    await worker().sweep(new Date(Date.now() - 1000));
    expect(events).toEqual([]);
    await worker().sweep(new Date(startsAt.getTime() + 1000));
    expect(events.length).toBeGreaterThanOrEqual(1);
    for (const event of events) CataloguePricesChangedEventSchema.parse(event);
  });

  it('every emission moves the change watermark; a non-emitting write does not', async () => {
    const before = await port().changeWatermark();
    await f.book({ audience: 'everyone', rows: [{ product: f.products.P1, fixed: '77' }] });
    const after = await port().changeWatermark();
    expect(events.length).toBeGreaterThanOrEqual(1);
    expect(after).not.toBe(before);
    events = [];
    await f.system(() =>
      f.books.createBook({
        name: 'Silent draft',
        type: 'regular',
        currencyCode: 'PLN',
        channelIds: [f.channels.CH1.id],
        audience: { kind: 'everyone', memberIds: [] },
        priority: 0,
      }),
    );
    expect(events).toEqual([]);
    expect(await port().changeWatermark()).toBe(after);
  });
});

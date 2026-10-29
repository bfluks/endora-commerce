import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ERROR_CODES } from '@endora-commerce/contracts';
import { setupBackendServer, teardownBackendServer, type BackendServerHandle } from '../../helpers/test-server.js';
import { setupPricingFixture, type PricingFixture } from '../../helpers/pricing-fixture.js';
import { BASE_BOOK_ID } from '../../helpers/price-book-sql.js';
import { settlePriceSurface } from '../../helpers/price-surface.js';

/**
 * Feature 011 / US2 → feature 160 — a price book's status lifecycle (T034, on
 * price books).
 *
 * `status` is what the admin shows; whether a book applies is read from its
 * dates at resolution time (FR-047, `applicability-dates.test.ts`). Verifies:
 *   - activation lands on `scheduled` for a future start and on `active`
 *     otherwise (FR-009 rows 1–2);
 *   - the status worker promotes `scheduled → active` and expires
 *     `active → expired` once the instants pass (rows 3–4), and a sweep with
 *     nothing due changes nothing;
 *   - an end not after the start is refused (FR-010);
 *   - an expired book can be moved back to draft (row 5), a base book cannot.
 *
 * The CRUD, duplication and base-book protections of the old `PriceListService`
 * are the price-book API's now: `contract/price_lists/price-books-api.test.ts`
 * and `price-book-duplicate.test.ts`.
 */
describe('price books — status lifecycle (feature 160, T034)', () => {
  let h: BackendServerHandle;
  let f: PricingFixture;
  const DAY = 86_400_000;
  const sql = <T>(statement: string, params: unknown[] = []) => h.em().getConnection().execute<T[]>(statement, params);
  const statusOf = async (id: string) =>
    (await sql<{ status: string }>(`select "status" from "price_lists" where "id" = ?`, [id]))[0]!.status;
  const versionOf = async (id: string) =>
    Number((await sql<{ version: number }>(`select "version" from "price_lists" where "id" = ?`, [id]))[0]!.version);
  const worker = () =>
    (h.container as unknown as { resolve<T>(name: string): T }).resolve<{
      handle: { statusWorker: { sweep(now: Date): Promise<{ scheduledToActive: number; activeToExpired: number }> } };
    }>('priceLists').handle.statusWorker;

  beforeAll(async () => {
    h = await setupBackendServer();
    f = await setupPricingFixture(h);
  }, 5 * 60_000);

  afterAll(async () => {
    await f.clearBooks();
    await teardownBackendServer(h);
  });

  const rows = () => [{ product: f.products.P1, fixed: '10' }];

  it('FR-009 rows 1–2: activation is scheduled for a future start, active otherwise', async () => {
    const later = await f.book({ audience: 'everyone', rows: rows(), startsAt: new Date(Date.now() + DAY) });
    expect(await statusOf(later.id)).toBe('scheduled');
    const now = await f.book({ audience: 'everyone', rows: rows(), startsAt: new Date(Date.now() - DAY) });
    expect(await statusOf(now.id)).toBe('active');
  });

  it('FR-009 rows 3–4: the worker promotes and expires once the instants pass; nothing due changes nothing', async () => {
    const scheduled = await f.book({ audience: 'everyone', rows: rows(), startsAt: new Date(Date.now() + DAY) });
    const live = await f.book({
      audience: 'everyone',
      rows: rows(),
      startsAt: new Date(Date.now() - DAY),
      endsAt: new Date(Date.now() + DAY),
    });
    const idle = await worker().sweep(new Date());
    expect(idle).toEqual({ scheduledToActive: 0, activeToExpired: 0 });
    const result = await worker().sweep(new Date(Date.now() + 2 * DAY));
    expect(result.scheduledToActive).toBeGreaterThanOrEqual(1);
    expect(result.activeToExpired).toBeGreaterThanOrEqual(1);
    expect(await statusOf(scheduled.id)).toBe('active');
    expect(await statusOf(live.id)).toBe('expired');
    const again = await worker().sweep(new Date(Date.now() + 2 * DAY));
    expect(again).toEqual({ scheduledToActive: 0, activeToExpired: 0 });
  });

  it('FR-010: an end not after the start is refused', async () => {
    const book = await f.book({ audience: 'everyone', rows: rows(), activate: false });
    const start = new Date(Date.now() + DAY).toISOString();
    const expectedVersion = await versionOf(book.id);
    await expect(
      f.system(() => f.books.patchBook(book.id, { startsAt: start, endsAt: start }, { expectedVersion })),
    ).rejects.toMatchObject({ statusCode: 400, code: ERROR_CODES.VALIDATION_FAILED });
  });

  it('FR-009 row 5: an expired book can be moved back to draft; a base book cannot', async () => {
    const book = await f.book({
      audience: 'everyone',
      rows: rows(),
      startsAt: new Date(Date.now() - 2 * DAY),
      endsAt: new Date(Date.now() + DAY),
    });
    await worker().sweep(new Date(Date.now() + 2 * DAY));
    expect(await statusOf(book.id)).toBe('expired');
    await f.system(() => f.books.draftify(book.id));
    expect(await statusOf(book.id)).toBe('draft');
    await expect(f.system(() => f.books.draftify(BASE_BOOK_ID))).rejects.toMatchObject({
      statusCode: 409,
      code: ERROR_CODES.PRICE_BOOK_IMMUTABLE_FIELD,
    });
  });

  /**
   * Review finding 5 (release 0.108.0) — patching a book's dates recomputes its
   * status by `activate()`'s rule (`expired` when it has ended, `scheduled`
   * before its start, `active` otherwise), for a live book; a draft stays a
   * draft and an expired book stays expired until it is activated again. An
   * `active` book moved to a future start used to stay `active`: the sweep
   * flips only `scheduled` books, so when it started pricing nothing marked
   * the price surface and the price order never took it in.
   */
  describe('patching the dates recomputes the status (review finding 5)', () => {
    const patchDates = async (id: string, dates: { startsAt?: string | null; endsAt?: string | null }) =>
      f.system(async () => f.books.patchBook(id, dates, { expectedVersion: await versionOf(id) }));
    const firstOrdered = async () =>
      (
        await f.pricing.orderByUnitPrice({
          context: { salesChannel: { id: f.channels.CH1.id, defaultCurrency: 'PLN' } },
          direction: 'asc',
          after: null,
          limit: 1,
        })
      ).rows[0];

    it('an active book moved to a future start is scheduled, and the surface takes it in at its start', async () => {
      await f.clearBooks();
      const book = await f.book({ audience: 'everyone', rows: [{ product: f.products.P1, fixed: '1' }] });
      expect(await statusOf(book.id)).toBe('active');
      await firstOrdered();
      await settlePriceSurface(h);
      expect(await firstOrdered()).toMatchObject({ productId: f.products.P1.id, amount: '1.0000' });

      const start = new Date(Date.now() + 2_000);
      await patchDates(book.id, { startsAt: start.toISOString() });
      expect(await statusOf(book.id)).toBe('scheduled');
      await settlePriceSurface(h);
      expect(await f.amount('guest', f.products.P1)).toBe('100.0000');
      expect(await firstOrdered()).not.toMatchObject({ productId: f.products.P1.id, amount: '1.0000' });

      await new Promise((resolve) => setTimeout(resolve, Math.max(0, start.getTime() - Date.now()) + 250));
      // FR-047: it prices at its instant; the sweep then flips it and marks the surface.
      expect(await f.amount('guest', f.products.P1)).toBe('1.0000');
      expect((await worker().sweep(new Date())).scheduledToActive).toBeGreaterThanOrEqual(1);
      expect(await statusOf(book.id)).toBe('active');
      await settlePriceSurface(h);
      expect(await firstOrdered()).toMatchObject({ productId: f.products.P1.id, amount: '1.0000' });
    });

    it('a scheduled book whose start moves to the past, or is cleared, is active', async () => {
      const a = await f.book({ audience: 'everyone', rows: rows(), startsAt: new Date(Date.now() + DAY) });
      const b = await f.book({ audience: 'everyone', rows: rows(), startsAt: new Date(Date.now() + DAY) });
      await patchDates(a.id, { startsAt: new Date(Date.now() - DAY).toISOString() });
      await patchDates(b.id, { startsAt: null });
      expect(await statusOf(a.id)).toBe('active');
      expect(await statusOf(b.id)).toBe('active');
    });

    it('a live book whose end moves to the past is expired, and stops ordering at once', async () => {
      await f.clearBooks();
      const book = await f.book({ audience: 'everyone', rows: [{ product: f.products.P1, fixed: '1' }], startsAt: new Date(Date.now() - DAY) });
      await firstOrdered();
      await settlePriceSurface(h);
      expect(await firstOrdered()).toMatchObject({ productId: f.products.P1.id, amount: '1.0000' });
      await patchDates(book.id, { endsAt: new Date(Date.now() - 1_000).toISOString() });
      expect(await statusOf(book.id)).toBe('expired');
      await settlePriceSurface(h);
      expect(await firstOrdered()).not.toMatchObject({ productId: f.products.P1.id, amount: '1.0000' });
    });

    it('a draft stays a draft and an expired book stays expired', async () => {
      const draft = await f.book({ audience: 'everyone', rows: rows(), activate: false });
      await patchDates(draft.id, { startsAt: new Date(Date.now() - DAY).toISOString() });
      expect(await statusOf(draft.id)).toBe('draft');
      const ended = await f.book({ audience: 'everyone', rows: rows(), startsAt: new Date(Date.now() - 2 * DAY), endsAt: new Date(Date.now() + DAY) });
      await worker().sweep(new Date(Date.now() + 2 * DAY));
      expect(await statusOf(ended.id)).toBe('expired');
      await patchDates(ended.id, { endsAt: new Date(Date.now() + 3 * DAY).toISOString() });
      expect(await statusOf(ended.id)).toBe('expired');
    });
  });
});

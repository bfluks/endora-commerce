import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { CatalogueReferencePricePort } from '@endora-commerce/contracts';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { setupPricingFixture, type PricingFixture } from '../../helpers/pricing-fixture.js';

/**
 * Spec 193 (`specs/193-product-visibility-rules/` contracts/ports.md §3, RQ-1 A, T011) —
 * whether a designated book prices its currency now, and why not. Every reason of
 * `DesignationStatus`, including a book that was deleted, unbound, re-audienced or left its
 * window after it was designated; `designationStatuses` answers in input order; and
 * `designatableBooks` lists the regular everyone books of the currency in any status.
 */
describe('catalogue designation status (spec 193, RQ-1 A)', () => {
  let h: BackendServerHandle;
  let f: PricingFixture;
  const port = () => (h.container as unknown as { resolve<T>(n: string): T }).resolve<CatalogueReferencePricePort>('catalogueReferencePricePort');
  const status = (priceListId: string, salesChannelId = f.channels.CH1.id, currencyCode = 'PLN') =>
    port().designationStatus({ currencyCode, priceListId, salesChannelId });
  const DAY = 24 * 3600 * 1000;

  beforeAll(async () => {
    h = await setupBackendServer();
    f = await setupPricingFixture(h);
  }, 5 * 60_000);

  afterAll(async () => {
    await f.clearBooks();
    await teardownBackendServer(h);
  });

  it('in force: a live, regular, everyone book of the currency on the channel — with its window', async () => {
    const endsAt = new Date(Date.now() + 10 * DAY);
    const book = await f.book({ audience: 'everyone', endsAt });
    const answer = await status(book.id);
    expect(answer.inForce).toBe(true);
    expect(answer.window?.startsAt ?? null).toBeNull();
    expect(new Date(answer.window!.endsAt!).getTime()).toBe(endsAt.getTime());
  });

  it('not_found — no such book, and a book deleted after it was designated', async () => {
    expect(await status('00000000-0000-4000-8000-000000000193')).toMatchObject({ inForce: false, reason: 'not_found' });
    const book = await f.book({ audience: 'everyone' });
    await f.system(() => f.books.deleteBook(book.id));
    expect(await status(book.id)).toMatchObject({ inForce: false, reason: 'not_found', window: null });
  });

  it('currency_mismatch — a book of another currency', async () => {
    const book = await f.book({ audience: 'everyone', currency: 'EUR', channels: [f.channels.CH2] });
    expect(await status(book.id, f.channels.CH2.id, 'PLN')).toMatchObject({ inForce: false, reason: 'currency_mismatch' });
  });

  it('not_regular — a sale book', async () => {
    const book = await f.book({ type: 'sale', audience: 'everyone' });
    expect(await status(book.id)).toMatchObject({ inForce: false, reason: 'not_regular' });
  });

  it('audience_restricted — a book for organizations, and an everyone book re-audienced later', async () => {
    const book = await f.book({ audience: { organizations: [f.orgs.Acme] } });
    expect(await status(book.id)).toMatchObject({ inForce: false, reason: 'audience_restricted' });
    const later = await f.book({ audience: 'everyone' });
    expect((await status(later.id)).inForce).toBe(true);
    await h.em().getConnection().execute(`update "price_lists" set "audience_kind" = 'organizations' where "id" = ?`, [later.id]);
    expect(await status(later.id)).toMatchObject({ inForce: false, reason: 'audience_restricted' });
  });

  it('not_on_channel — a book not bound to the channel, and one unbound later', async () => {
    const book = await f.book({ audience: 'everyone' });
    expect(await status(book.id, f.channels.CH2.id)).toMatchObject({ inForce: false, reason: 'not_on_channel' });
    await f.system(() => f.books.replaceChannels(book.id, [f.channels.CH2.id]));
    expect(await status(book.id, f.channels.CH1.id)).toMatchObject({ inForce: false, reason: 'not_on_channel' });
  });

  it('not_active — a draft book', async () => {
    const book = await f.book({ audience: 'everyone', activate: false });
    expect(await status(book.id)).toMatchObject({ inForce: false, reason: 'not_active' });
  });

  it('outside_schedule — a scheduled book before its window, and an expired one', async () => {
    const startsAt = new Date(Date.now() + 5 * DAY);
    const scheduled = await f.book({ audience: 'everyone', startsAt });
    const answer = await status(scheduled.id);
    expect(answer).toMatchObject({ inForce: false, reason: 'outside_schedule' });
    expect(new Date(answer.window!.startsAt!).getTime()).toBe(startsAt.getTime());
    const book = await f.book({ audience: 'everyone' });
    await h
      .em()
      .getConnection()
      .execute(`update "price_lists" set "ends_at" = now() - interval '1 hour' where "id" = ?`, [book.id]);
    expect(await status(book.id)).toMatchObject({ inForce: false, reason: 'outside_schedule' });
  });

  it('a refusing reason is reported before a not-in-force one (draft and unbound ⇒ not_on_channel)', async () => {
    const book = await f.book({ audience: 'everyone', activate: false });
    expect(await status(book.id, f.channels.CH2.id)).toMatchObject({ inForce: false, reason: 'not_on_channel' });
  });

  it('designationStatuses answers many at once, in input order', async () => {
    const live = await f.book({ audience: 'everyone' });
    const draft = await f.book({ audience: 'everyone', activate: false });
    const answers = await port().designationStatuses([
      { currencyCode: 'PLN', priceListId: draft.id, salesChannelId: f.channels.CH1.id },
      { currencyCode: 'PLN', priceListId: live.id, salesChannelId: f.channels.CH1.id },
      { currencyCode: 'PLN', priceListId: live.id, salesChannelId: f.channels.CH2.id },
    ]);
    expect(answers.map((a) => (a.inForce ? 'in_force' : a.reason))).toEqual(['not_active', 'in_force', 'not_on_channel']);
    expect(await port().designationStatuses([])).toEqual([]);
  });

  it('designatableBooks — regular everyone books of the currency in any status, with their channels', async () => {
    await f.clearBooks();
    const live = await f.book({ name: 'Live', audience: 'everyone', channels: [f.channels.CH1, f.channels.CH2] });
    const draft = await f.book({ name: 'Draft', audience: 'everyone', activate: false });
    await f.book({ name: 'Sale', type: 'sale', audience: 'everyone' });
    await f.book({ name: 'Org', audience: { organizations: [f.orgs.Acme] } });
    await f.book({ name: 'Euro', audience: 'everyone', currency: 'EUR', channels: [f.channels.CH2] });
    const books = await port().designatableBooks('PLN');
    expect(books.map((b) => b.priceListId).sort()).toEqual([live.id, draft.id].sort());
    expect([...books.find((b) => b.priceListId === live.id)!.salesChannelIds].sort()).toEqual(
      [f.channels.CH1.id, f.channels.CH2.id].sort(),
    );
  });
});

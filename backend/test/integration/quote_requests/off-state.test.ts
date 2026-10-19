import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { expectModuleAbsent, withModuleOff } from '../../helpers/off-state.js';
import {
  CustomerAccount,
  Organization,
  QuoteRequest,
  QuoteRequestAccountPolicy,
  QuoteRequestOrgPolicy,
} from '../../helpers/package-entities.js';
import { QUOTE_REQUESTS_SETTING_CODES } from '../../../../packages/modules/quote_requests/src/manifest.js';
import { SEED_PRODUCT_101_ID } from '../../helpers/seed-catalog.js';
import {
  CUSTOMER_COOKIES,
  TEST_CUSTOMER_ID,
  TEST_ORGANIZATION_ID,
} from '../../helpers/test-actors.js';
import { withSystemScope } from '../../../src/tenancy/escape-hatch.js';
import { Order } from '../../helpers/package-entities.js';
import { whenOrderCreatedSettled } from '../../helpers/quote-conversion.js';
import { bindOrganizationsToFixtureChannelsSql } from '../../helpers/sales-channel-access.js';

/**
 * `quote_requests` off-state — Constitution XVII item 6, from a **package**
 * (feature 080, T040b).
 *
 * The module lives in `packages/modules/quote_requests` now, and every gate it
 * relies on is applied by `ctx.routes` / `ctx.subscribe` in the kernel
 * container. Nothing about those seams is supposed to change when a module's
 * sources move — this file is what turns "supposed to" into a measurement.
 *
 * **The subscriber is the half `blog` left uncovered** (!910). `blog`'s only
 * `ctx.subscribe` listens for `settings.value_changed` and drops a cache, which
 * is invisible from outside: a test cannot tell a subscriber that did not run
 * from one that ran and cleared an already-empty cache, so the packaged
 * `ctx.subscribe` seam had no proof at all. `quote_requests`' subscriber
 * **writes** — `order.created.v1` flips the originating quote request to
 * `Completed`, appends a `completed` event row and enqueues a notification — so
 * "did it run" is a row. And issue #107's regression is exactly that handler
 * going on doing all three while every route that could show the customer the
 * quote request refused.
 *
 * The positive control comes first, for the reason `mfa`'s off-state test gives:
 * without it, a subscriber that never worked at all would read as a successful
 * absence.
 */
describe('quote_requests off-state, from a package (Constitution XVII)', () => {
  let h: BackendServerHandle;
  /** The completion reactor, taken while the module is on: its handle is gated. */
  let reactor: { idle(): Promise<void> };
  const admin = { b2b_session: 'stub-admin-session' };
  const customer = { b2b_session: 'stub-customer-session' };

  beforeAll(async () => {
    h = await setupBackendServer();
    reactor = (h.container.resolve('quoteRequests') as { handle(): { orderCompletionReactor: typeof reactor } })
      .handle().orderCompletionReactor;
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('is absent from every surface while off, and restored after', async () => {
    await expectModuleAbsent(h, 'quote_requests', {
      routes: [
        { url: '/api/v1/admin/quote-requests', cookies: admin },
        { url: '/api/v1/admin/quote-requests/list-views', cookies: admin },
        // `specs/157-custom-fields-list-filters/` — the list's offered custom-field filters.
        { url: '/api/v1/admin/quote-requests/custom-field-filters', cookies: admin },
        { url: '/api/v1/quote-requests', cookies: customer },
        '/api/v1/storefront/settings/quote-requests',
      ],
      adminPresence: { cookies: admin },
      settingWrite: {
        code: QUOTE_REQUESTS_SETTING_CODES.EXPIRY_DAYS,
        value: 21,
        cookies: admin,
      },
    });
  });

  /**
   * `specs/147-saved-views/` FR-018 (US3-7, threat model S-09): a saved view
   * on the Quote Request list is refused on **every** method while the module
   * is off — the collection's `GET` and `POST` and the item's `PATCH` and
   * `DELETE` — exactly as the list itself is, and the stored row is untouched:
   * once the module is back the view is listed as it was.
   */
  it('refuses all four saved-view routes while deactivated and keeps the view (FR-018)', async () => {
    const VIEWS = '/api/v1/admin/quote-requests/list-views';
    const name = `Off-state view ${randomUUID().slice(0, 8)}`;
    const created = await h.app.inject({
      method: 'POST',
      url: VIEWS,
      cookies: admin,
      payload: { name, shared: true, filters: { scope: 'all' }, sort: { field: 'total', dir: 'desc' } },
    });
    expect(created.statusCode).toBe(201);
    const view = (created.json() as { data: { id: string } }).data;

    const listView = async (): Promise<unknown> => {
      const res = await h.app.inject({ method: 'GET', url: VIEWS, cookies: admin });
      expect(res.statusCode).toBe(200);
      return (res.json() as { data: Array<{ id: string }> }).data.find((v) => v.id === view.id);
    };
    const before = await listView();
    expect(before).toMatchObject({ name, shared: true, filters: { scope: 'all' } });

    await withModuleOff('quote_requests', 'deactivated', async () => {
      const list = await h.app.inject({ method: 'GET', url: '/api/v1/admin/quote-requests', cookies: admin });
      const probes = [
        { method: 'GET' as const, url: VIEWS },
        { method: 'POST' as const, url: VIEWS, payload: { name: `${name} 2`, shared: false, filters: {} } },
        { method: 'PATCH' as const, url: `${VIEWS}/${view.id}`, payload: { name: `${name} renamed` } },
        { method: 'DELETE' as const, url: `${VIEWS}/${view.id}` },
      ];
      for (const probe of probes) {
        const res = await h.app.inject({ ...probe, cookies: admin });
        expect(res.statusCode, `${probe.method} ${probe.url}`).toBe(list.statusCode);
        expect((res.json() as { error?: { code?: string } }).error?.code, `${probe.method} ${probe.url}`).toBe(
          (list.json() as { error?: { code?: string } }).error?.code,
        );
      }
      // The list itself is what the four are measured against; it answers the
      // module's absence, so a match above is a refusal and not a coincidence.
      expect(list.statusCode).toBe(503);
      expect((list.json() as { error?: { code?: string } }).error?.code).toBe('MODULE_DISABLED');
    });

    expect(await listView()).toEqual(before);
  });

  /**
   * One submitted quote request, and one order pointing back at it.
   *
   * The order is written directly rather than checked out: the reactor reads it
   * through `orderReadPort` and needs only `sourceQuoteRequestId`, and a full
   * checkout would put four other modules between this test and the thing it is
   * measuring.
   */
  async function quoteRequestWithOrder(): Promise<{ quoteRequestId: string; orderId: string }> {
    const created = await h.app.inject({
      method: 'POST',
      url: '/api/v1/quote-requests',
      cookies: customer,
      payload: { items: [{ productId: SEED_PRODUCT_101_ID, quantity: 1 }] },
    });
    expect(created.statusCode).toBe(201);
    const quoteRequestId = (created.json() as { data: { id: string } }).data.id;

    const em = h.em();
    const order = em.create(Order, {
      organizationId: TEST_ORGANIZATION_ID,
      placedByCustomerAccountId: TEST_CUSTOMER_ID,
      salesChannelId: randomUUID(),
      status: 'completed',
      deliveryAddress: { recipientName: 'A', street: 'S', city: 'C', postalCode: '00-000', country: 'PL' },
      billingAddress: { recipientName: 'A', street: 'S', city: 'C', postalCode: '00-000', country: 'PL' },
      deliveryMethodId: randomUUID(),
      deliveryMethodSnapshot: { code: 'dm', name: 'DM', cost: 0 },
      paymentMethodId: randomUUID(),
      paymentMethodSnapshot: { code: 'pm', name: 'PM', kind: 'bank_transfer' },
      subtotal: '10.00',
      taxTotal: '0.00',
      deliveryTotal: '0.00',
      total: '10.00',
      currency: 'PLN',
      placedAt: new Date(),
      sourceQuoteRequestId: quoteRequestId,
    });
    await em.persistAndFlush(order);
    return { quoteRequestId, orderId: order.id };
  }

  /**
   * `emit` dispatches without a scope and the handlers are async, so wait for
   * them — for the bus's chain to reach its end, and for the reactor's second
   * look where it took one — rather than for a number of milliseconds. This
   * slept 50 ms; measured on a busy machine the completion lands 27 to 67 ms
   * after the event, so both cases below failed now and then for no reason of
   * their own.
   */
  async function announceOrder(orderId: string): Promise<void> {
    await whenOrderCreatedSettled(h, async () => {
      h.eventBus.emit('order.created.v1', { orderId } as never);
    });
    await reactor.idle();
  }

  async function statusOf(quoteRequestId: string): Promise<string | undefined> {
    const em = h.em();
    em.clear();
    return (await em.findOne(QuoteRequest, { id: quoteRequestId }))?.status;
  }

  it('the packaged subscriber runs: order.created.v1 completes the quote request', async () => {
    const { quoteRequestId, orderId } = await quoteRequestWithOrder();
    await announceOrder(orderId);
    expect(await statusOf(quoteRequestId)).toBe('Completed');
  });

  it('and stops while the module is deactivated, then resumes (issue #107)', async () => {
    const { quoteRequestId, orderId } = await quoteRequestWithOrder();
    const before = await statusOf(quoteRequestId);
    expect(before).not.toBe('Completed');

    await withModuleOff('quote_requests', 'deactivated', async () => {
      await announceOrder(orderId);
      expect(await statusOf(quoteRequestId)).toBe(before);
    });

    await announceOrder(orderId);
    expect(await statusOf(quoteRequestId)).toBe('Completed');
  });

  /**
   * Feature 146 (T085, FR-028) — the price-negotiation lock and the history
   * read are module surfaces like any other: while `quote_requests` is off the
   * four admin negotiation routes, the buyer's own read and `/history` answer
   * `MODULE_DISABLED`; the stored policy rows are not touched by the flip; and
   * once it is back on, the routes answer the values written before.
   *
   * The organization, account and buyer session are this file's own, so a
   * lock written here cannot reach another file's buyer.
   */
  describe('feature 146 — negotiation lock and history (FR-028)', () => {
    const stamp = Date.now();
    const BUYER_SESSION = `stub-146-off-buyer-${stamp}`;
    const buyer = { b2b_session: BUYER_SESSION };
    let organizationId: string;
    let customerAccountId: string;
    let quoteRequestId: string;

    const orgUrl = () => `/api/v1/admin/organizations/${organizationId}/quote-price-negotiation`;
    const accountUrl = () => `/api/v1/admin/customers/${customerAccountId}/quote-price-negotiation`;
    const historyUrl = () => `/api/v1/admin/quote-requests/${quoteRequestId}/history`;
    const STOREFRONT_URL = '/api/v1/quote-requests/price-negotiation';

    const policyRows = () =>
      withSystemScope('146 T085: read the policy rows back across the off-state flip', async () => {
        const em = h.orm.em.fork();
        const org = await em.findOne(QuoteRequestOrgPolicy, { organizationId });
        const account = await em.findOne(QuoteRequestAccountPolicy, { customerAccountId });
        return {
          org: org ? { allowed: org.priceProposalsAllowed, updatedAt: org.updatedAt.toISOString() } : null,
          account: account
            ? { allowed: account.priceProposalsAllowed, updatedAt: account.updatedAt.toISOString() }
            : null,
        };
      });

    beforeAll(async () => {
      await withSystemScope('146 T085: seed the off-state tenant', async () => {
        const em = h.orm.em.fork();
        const org = em.create(Organization, {
          name: `146 off-state ${stamp}`,
          taxId: `PL146O${String(stamp).slice(-7)}`,
          status: 'active',
          vatStatus: 'vat_payer',
          registeredAddress: { street: 'ul. Testowa 1', city: 'Warszawa', postalCode: '00-100', country: 'PL' },
        });
        await em.persistAndFlush(org);
        const account = em.create(CustomerAccount, {
          organizationId: org.id,
          email: `146-off-${stamp}@off.local`,
          passwordHash: 'x'.repeat(60),
          firstName: '146',
          lastName: 'off',
          role: 'regular_user',
        });
        await em.persistAndFlush(account);
        organizationId = org.id;
        // Feature 154 — the tenant shops on the stores the harness seeds.
        await bindOrganizationsToFixtureChannelsSql(em, [org.id]);
        customerAccountId = account.id;
      });
      CUSTOMER_COOKIES[BUYER_SESSION] = { customerAccountId, organizationId };

      const created = await h.app.inject({
        method: 'POST',
        url: '/api/v1/quote-requests',
        cookies: buyer,
        payload: { items: [{ productId: SEED_PRODUCT_101_ID, quantity: 1 }] },
      });
      expect(created.statusCode, created.body).toBe(201);
      quoteRequestId = (created.json() as { data: { id: string } }).data.id;

      const orgWrite = await h.app.inject({
        method: 'PUT',
        url: orgUrl(),
        cookies: admin,
        payload: { priceProposalsAllowed: false },
      });
      expect(orgWrite.statusCode, orgWrite.body).toBe(200);
      const accountWrite = await h.app.inject({
        method: 'PUT',
        url: accountUrl(),
        cookies: admin,
        payload: { override: 'allowed' },
      });
      expect(accountWrite.statusCode, accountWrite.body).toBe(200);
    });

    afterAll(() => {
      delete CUSTOMER_COOKIES[BUYER_SESSION];
    });

    it('the four admin routes, the storefront read and /history are absent while off, and restored after', async () => {
      await expectModuleAbsent(h, 'quote_requests', {
        routes: [
          { url: orgUrl(), cookies: admin },
          { method: 'PUT', url: orgUrl(), cookies: admin, payload: { priceProposalsAllowed: false } },
          { url: accountUrl(), cookies: admin },
          { method: 'PUT', url: accountUrl(), cookies: admin, payload: { override: 'allowed' } },
          { url: STOREFRONT_URL, cookies: buyer },
          { url: historyUrl(), cookies: admin },
        ],
      });
    });

    it('keeps the stored values through the flip, and answers them once switched back on', async () => {
      const before = await policyRows();
      expect(before.org?.allowed).toBe(false);
      expect(before.account?.allowed).toBe(true);

      await withModuleOff('quote_requests', 'deactivated', async () => {
        const refused = await h.app.inject({
          method: 'PUT',
          url: orgUrl(),
          cookies: admin,
          payload: { priceProposalsAllowed: true },
        });
        expect(refused.statusCode).toBe(503);
        expect(await policyRows()).toEqual(before);
      });

      expect(await policyRows()).toEqual(before);

      const org = await h.app.inject({ method: 'GET', url: orgUrl(), cookies: admin });
      expect(org.statusCode, org.body).toBe(200);
      expect((org.json() as { data: { priceProposalsAllowed: boolean } }).data.priceProposalsAllowed).toBe(false);

      const account = await h.app.inject({ method: 'GET', url: accountUrl(), cookies: admin });
      expect(account.statusCode, account.body).toBe(200);
      expect(account.json()).toMatchObject({
        data: {
          override: 'allowed',
          organizationPriceProposalsAllowed: false,
          effectivePriceProposalsAllowed: true,
          effectiveSource: 'account',
        },
      });

      const own = await h.app.inject({ method: 'GET', url: STOREFRONT_URL, cookies: buyer });
      expect(own.statusCode, own.body).toBe(200);
      expect(own.json()).toEqual({ data: { priceProposalsAllowed: true } });

      const history = await h.app.inject({ method: 'GET', url: historyUrl(), cookies: admin });
      expect(history.statusCode, history.body).toBe(200);
    });
  });
});

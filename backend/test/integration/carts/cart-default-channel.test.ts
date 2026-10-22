import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SalesChannel } from '@endora-commerce/platform/kernel';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { TEST_CUSTOMER_EMPTY_ID, TEST_ORGANIZATION_ID } from '../../helpers/test-actors.js';

/**
 * Feature 053 — FR-010: a null-channel cart must not reach pricing or checkout
 * with a null channel (the old silent no-op). Held by construction: a basket is
 * created on a concrete channel, so every promotion and price snapshot built for
 * it receives a real `salesChannelId`.
 *
 * Since `specs/154-sales-channel-access/` (User Story 6) that channel is the one
 * the basket is used on, not the system default whatever the request — the
 * creation path `#defaultSalesChannelId` is gone, and so is the system-default
 * fallback the price recompute kept for a basket with no channel (contracts/
 * basket-attribution.md §2): neither has a basket to answer for.
 */
describe('a basket carries the channel it is created on (feature 053 / FR-010, 154 US6)', () => {
  let h: BackendServerHandle;
  let other: SalesChannel;

  beforeAll(async () => {
    h = await setupBackendServer();
    const em = h.em();
    other = em.create(SalesChannel, {
      code: `basket-origin-${randomUUID().slice(0, 8)}`,
      name: { 'en-US': 'Basket origin' },
      languages: ['en-US'],
      defaultLanguage: 'en-US',
      currencies: ['PLN'],
      defaultCurrency: 'PLN',
      active: true,
    });
    await em.persistAndFlush(other);
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('creates an anonymous basket on the channel it is asked for — never null', async () => {
    const def = await h.salesChannels.resolver.getSystemDefault();
    const cartService = h.cartService()!;

    const onDefault = await cartService.getOrCreateForAnon(h.em(), `fr010-${randomUUID()}`, def.id);
    expect(onDefault?.salesChannelId).toBe(def.id);

    const onOther = await cartService.getOrCreateForAnon(h.em(), `fr010-${randomUUID()}`, other.id);
    expect(onOther?.salesChannelId).toBe(other.id);
  });

  it('creates a customer basket on the channel of the context, not the system default', async () => {
    const ctx = {
      customerAccountId: TEST_CUSTOMER_EMPTY_ID,
      organizationId: TEST_ORGANIZATION_ID,
      salesChannelId: other.id,
    };
    const cart = await h.cartService()!.getOrCreateForCustomer(ctx);
    expect(cart.salesChannelId).toBe(other.id);
    await h.cartService()!.clearForCustomer(ctx);
  });
});

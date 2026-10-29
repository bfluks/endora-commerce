import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Redis } from 'ioredis';
import { ERROR_CODES } from '@endora-commerce/contracts';
import { SalesChannel } from '@endora-commerce/platform/kernel';
import {
  SALES_CHANNEL_ACCESS_LRU_TTL_MS,
  SalesChannelAccessCache,
} from '../../../../packages/platform/src/kernel/sales-channels/sales-channel-access-cache.js';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { TEST_ORGANIZATION_ID } from '../../helpers/test-actors.js';
import { assignOrganizationChannels } from '../../helpers/sales-channel-access.js';

/**
 * Feature 154 — an Organization's assignment change is honoured on the writing
 * process at once and on every other process within the LRU window (FR-036,
 * SC-005; `contracts/channel-access-rule.md` §5).
 *
 * The writer is the composed application, changed through the administrator's
 * membership route. "Another process" is a second {@link SalesChannelAccessCache}
 * on the same Redis with its own subscriber connection — the object every
 * composed process holds — so the announcement crosses a real pub/sub hop.
 * Pub/sub is armed here only, for the memory reason
 * `integration/kernel/cross-process-invalidation.test.ts` gives.
 */

const ADMIN = { b2b_session: 'stub-admin-session' };
const CUSTOMER = { b2b_session: 'stub-customer-session' };
const PROBE = '/api/v1/catalog/products';

describe('channel-access invalidation', () => {
  let h: BackendServerHandle;
  let subscriber: Redis;
  let tradeId: string;

  /** The bridge read another process would make, counted. */
  function loader(): { load: (orgId: string) => Promise<string[]>; calls: () => number } {
    let calls = 0;
    return {
      load: async (orgId) => {
        calls += 1;
        const rows = await h
          .em()
          .execute<Array<{ sales_channel_id: string }>>(
            'select "sales_channel_id" from "sales_channel_organizations" where "organization_id" = ?',
            [orgId],
          );
        return rows.map((r) => r.sales_channel_id);
      },
      calls: () => calls,
    };
  }

  async function membership(method: 'PUT' | 'DELETE'): Promise<void> {
    const res = await h.app.inject({
      method,
      url: `/api/v1/admin/sales-channels/trade/organization/${TEST_ORGANIZATION_ID}`,
      cookies: ADMIN,
      payload: {},
    });
    expect([200, 201, 204]).toContain(res.statusCode);
  }

  async function onTrade(): Promise<number> {
    const res = await h.app.inject({
      method: 'GET',
      url: PROBE,
      headers: { 'x-sales-channel': 'trade' },
      cookies: CUSTOMER,
    });
    if (res.statusCode === 403) {
      expect((res.json() as { error: { code: string } }).error.code).toBe(
        ERROR_CODES.SALES_CHANNEL_NOT_PERMITTED,
      );
    }
    return res.statusCode;
  }

  async function eventually(check: () => Promise<boolean>, timeoutMs = 1_000): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (await check()) return true;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    return check();
  }

  beforeAll(async () => {
    h = await setupBackendServer({ exercisePubSub: true });
    const em = h.em();
    const trade = em.create(SalesChannel, {
      code: 'trade',
      name: { 'en-US': 'Trade' },
      languages: ['en-US'],
      defaultLanguage: 'en-US',
      currencies: ['PLN'],
      defaultCurrency: 'PLN',
      active: true,
    });
    await em.flush();
    tradeId = trade.id;
    await h.salesChannels.cache.invalidateAll();
    subscriber = h.redis.duplicate();
  }, 180_000);

  afterAll(async () => {
    subscriber.removeAllListeners('message');
    try {
      await subscriber.unsubscribe();
    } catch {
      // already closed
    }
    subscriber.disconnect();
    await assignOrganizationChannels(h, TEST_ORGANIZATION_ID, ['default']);
    await teardownBackendServer(h);
  });

  it('decides the next request on the writing process on the new assignment', async () => {
    await assignOrganizationChannels(h, TEST_ORGANIZATION_ID, ['default']);
    expect(await onTrade()).toBe(403);
    await membership('PUT');
    expect(await onTrade()).toBe(200);
    await membership('DELETE');
    expect(await onTrade()).toBe(403);
  });

  it('drops another process’s entry when the change is announced', async () => {
    await assignOrganizationChannels(h, TEST_ORGANIZATION_ID, ['default']);
    const other = loader();
    const elsewhere = new SalesChannelAccessCache(h.redis, other.load);
    await elsewhere.watch(subscriber);
    // Let the SUBSCRIBE land before anything is published.
    await new Promise((resolve) => setTimeout(resolve, 100));

    expect((await elsewhere.permittedChannelIds(TEST_ORGANIZATION_ID)).has(tradeId)).toBe(false);
    const callsBefore = other.calls();

    await membership('PUT');

    expect(
      await eventually(async () =>
        (await elsewhere.permittedChannelIds(TEST_ORGANIZATION_ID)).has(tradeId),
      ),
    ).toBe(true);
    expect(other.calls()).toBeGreaterThan(callsBefore);
    await membership('DELETE');
  });

  it('without the announcement, converges once the in-process window has passed', async () => {
    await assignOrganizationChannels(h, TEST_ORGANIZATION_ID, ['default']);
    let now = 0;
    const other = loader();
    // Never subscribed: the announcement is lost to it.
    const deaf = new SalesChannelAccessCache(h.redis, other.load, () => now);
    expect((await deaf.permittedChannelIds(TEST_ORGANIZATION_ID)).has(tradeId)).toBe(false);

    await membership('PUT');

    now += SALES_CHANNEL_ACCESS_LRU_TTL_MS - 1;
    expect((await deaf.permittedChannelIds(TEST_ORGANIZATION_ID)).has(tradeId)).toBe(false);
    now += 1;
    expect((await deaf.permittedChannelIds(TEST_ORGANIZATION_ID)).has(tradeId)).toBe(true);
    await membership('DELETE');
  });
});

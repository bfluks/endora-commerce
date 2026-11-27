import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  PublicSalesChannelResponseSchema,
  SalesChannelAccessResponseSchema,
  type SalesChannelAccessResponse,
} from '@endora-commerce/contracts';
import { SalesChannel, Setting, SettingValue } from '@endora-commerce/platform/kernel';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { TEST_ORGANIZATION_ID } from '../../helpers/test-actors.js';
import {
  assignOrganizationChannels,
  setChannelAnonymousAccess,
} from '../../helpers/sales-channel-access.js';

/**
 * Feature 154 — what the storefront learns about channel access
 * (`contracts/storefront-api.md` §1–§2; FR-001, FR-012).
 *
 *  - `GET /api/v1/storefront/sales-channel` carries `anonymousAccess` and stays
 *    reachable on a closed channel: it is how a storefront knows to send a
 *    visitor to sign-in.
 *  - `GET /api/v1/storefront/sales-channel/access` answers the same decision the
 *    access step makes, for this viewer, and never refuses; a refused customer
 *    learns which stores the account may use.
 */

const CUSTOMER = { b2b_session: 'stub-customer-session' };
const ADMIN = { b2b_admin_session: 'stub-admin-session' };

describe('storefront channel access reads', () => {
  let h: BackendServerHandle;

  async function access(
    channel: string,
    cookies?: Record<string, string>,
  ): Promise<{ status: number; cacheControl: unknown; body: SalesChannelAccessResponse['data'] }> {
    const res = await h.app.inject({
      method: 'GET',
      url: '/api/v1/storefront/sales-channel/access',
      headers: { 'x-sales-channel': channel },
      ...(cookies ? { cookies } : {}),
    });
    const parsed = SalesChannelAccessResponseSchema.parse(res.json());
    return {
      status: res.statusCode,
      cacheControl: res.headers['cache-control'],
      body: parsed.data,
    };
  }

  beforeAll(async () => {
    h = await setupBackendServer();
    const em = h.em();
    for (const [code, anonymousAccess, active] of [
      ['trade', false, true],
      ['outlet', true, true],
      ['dormant', true, false],
    ] as const) {
      em.create(SalesChannel, {
        code,
        name: { 'en-US': code.toUpperCase() },
        languages: ['en-US'],
        defaultLanguage: 'en-US',
        currencies: ['PLN'],
        defaultCurrency: 'PLN',
        active,
        anonymousAccess,
      });
    }
    await em.flush();
    await h.salesChannels.cache.invalidateAll();
    const outlet = await em.findOneOrFail(SalesChannel, { code: 'outlet' });
    const setting = await em.findOneOrFail(Setting, { code: 'sales_channels.storefront_url' });
    em.create(SettingValue, { setting, salesChannel: outlet, value: 'https://outlet.example.com' });
    await em.flush();
    await h.settings.cache.invalidateAll();
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  beforeEach(async () => {
    await assignOrganizationChannels(h, TEST_ORGANIZATION_ID, ['default']);
  });

  it('carries anonymousAccess on the channel identity, and serves it on a closed channel', async () => {
    const closed = await h.app.inject({
      method: 'GET',
      url: '/api/v1/storefront/sales-channel',
      headers: { 'x-sales-channel': 'trade' },
    });
    expect(closed.statusCode).toBe(200);
    expect(PublicSalesChannelResponseSchema.parse(closed.json()).data.anonymousAccess).toBe(false);

    const open = await h.app.inject({ method: 'GET', url: '/api/v1/storefront/sales-channel' });
    expect(PublicSalesChannelResponseSchema.parse(open.json()).data.anonymousAccess).toBe(true);
  });

  it('reports an anonymous viewer on an open and a closed channel, privately', async () => {
    const open = await access('outlet');
    expect(open.status).toBe(200);
    expect(open.cacheControl).toBe('private, no-store');
    expect(open.body).toEqual({
      channelCode: 'outlet',
      anonymousAccess: true,
      viewer: 'anonymous',
      permitted: true,
      reason: null,
      permittedChannels: [],
    });

    const closed = await access('trade');
    expect(closed.status).toBe(200);
    expect(closed.body).toMatchObject({
      viewer: 'anonymous',
      permitted: false,
      reason: 'sign_in_required',
      permittedChannels: [],
    });
  });

  it('reports a refused customer with the active stores the account may use', async () => {
    await assignOrganizationChannels(h, TEST_ORGANIZATION_ID, ['default', 'outlet', 'dormant']);
    const res = await access('trade', CUSTOMER);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      channelCode: 'trade',
      viewer: 'customer',
      permitted: false,
      reason: 'not_permitted',
    });
    expect(res.body.permittedChannels).toEqual([
      { code: 'default', name: expect.any(Object), storefrontUrl: null },
      { code: 'outlet', name: { 'en-US': 'OUTLET' }, storefrontUrl: 'https://outlet.example.com' },
    ]);
  });

  it('reports a permitted customer', async () => {
    await assignOrganizationChannels(h, TEST_ORGANIZATION_ID, ['default', 'trade']);
    const res = await access('trade', CUSTOMER);
    expect(res.body).toMatchObject({ viewer: 'customer', permitted: true, reason: null });
    expect(res.body.permittedChannels.map((c) => c.code)).toEqual(['default', 'trade']);
  });

  it('reports an administrator as a viewer the rule does not decide', async () => {
    const res = await access('trade', ADMIN);
    expect(res.body).toMatchObject({
      viewer: 'other',
      permitted: true,
      reason: null,
      permittedChannels: [],
    });
  });

  it('is reachable when the channel is closed and the default too', async () => {
    await setChannelAnonymousAccess(h, 'default', false);
    try {
      const res = await access('default');
      expect(res.status).toBe(200);
      expect(res.body.reason).toBe('sign_in_required');
    } finally {
      await setChannelAnonymousAccess(h, 'default', true);
    }
  });
});

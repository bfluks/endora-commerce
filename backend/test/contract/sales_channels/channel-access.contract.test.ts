import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ERROR_CODES } from '@endora-commerce/contracts';
import { SalesChannel } from '@endora-commerce/platform/kernel';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import {
  CUSTOMER_COOKIES,
  TEST_CUSTOMER_ID,
  TEST_ORGANIZATION_ID,
} from '../../helpers/test-actors.js';
import {
  assignOrganizationChannels,
  setChannelAnonymousAccess,
} from '../../helpers/sales-channel-access.js';

/**
 * Feature 154 — the kernel's access step (`contracts/channel-access-rule.md`
 * §1–§3; FR-004, FR-005, FR-007, FR-008).
 *
 * After a request's channel is resolved — by header, query, host map or the
 * system-default fallback — an anonymous request is answered only on a channel
 * open to anonymous visitors and a customer request only on a channel assigned
 * to the customer's Organization. Administrators and API keys are not decided.
 *
 * Every row is driven over each resolution path, because a rule that held for
 * the header and not for the fallback would be bypassed by leaving the header
 * out.
 */

const PROBE = '/api/v1/catalog/products';
const CUSTOMER = { b2b_session: 'stub-customer-session' };
const NO_ORG_CUSTOMER = { b2b_session: 'stub-customer-session-no-org' };
const ADMIN = { b2b_session: 'stub-admin-session' };
const TRADE_HOST = 'trade.channel-access.test';
const OPEN_HOST = 'open.channel-access.test';

type Signal = 'header' | 'query' | 'host';

function request(signal: Signal, code: 'trade' | 'open-b') {
  const host = code === 'trade' ? TRADE_HOST : OPEN_HOST;
  switch (signal) {
    case 'header':
      return { url: PROBE, headers: { 'x-sales-channel': code } as Record<string, string> };
    case 'query':
      return { url: `${PROBE}?salesChannel=${code}`, headers: {} as Record<string, string> };
    case 'host':
      return { url: PROBE, headers: { host } as Record<string, string> };
  }
}

function errorOf(res: { json: () => unknown }): {
  code: string;
  details?: Record<string, unknown>;
} {
  return (res.json() as { error: { code: string; details?: Record<string, unknown> } }).error;
}

describe('sales-channel access step', () => {
  let h: BackendServerHandle;
  const previousHostMap = process.env['SALES_CHANNEL_HOST_MAP'];

  beforeAll(async () => {
    // Read once, when the resolver is composed.
    process.env['SALES_CHANNEL_HOST_MAP'] = `${TRADE_HOST}=trade,${OPEN_HOST}=open-b`;
    // A session whose account resolves to no Organization — a data
    // inconsistency the rule must refuse rather than read as anonymous (FR-008).
    CUSTOMER_COOKIES['stub-customer-session-no-org'] = {
      customerAccountId: TEST_CUSTOMER_ID,
      organizationId: '',
    };
    h = await setupBackendServer();
    const em = h.em();
    for (const [code, anonymousAccess] of [
      ['trade', false],
      ['open-b', true],
    ] as const) {
      em.create(SalesChannel, {
        code,
        name: { 'en-US': code },
        languages: ['en-US'],
        defaultLanguage: 'en-US',
        currencies: ['PLN'],
        defaultCurrency: 'PLN',
        active: true,
        anonymousAccess,
      });
    }
    await em.flush();
    await h.salesChannels.cache.invalidateAll();
  });

  afterAll(async () => {
    await teardownBackendServer(h);
    delete CUSTOMER_COOKIES['stub-customer-session-no-org'];
    if (previousHostMap === undefined) delete process.env['SALES_CHANNEL_HOST_MAP'];
    else process.env['SALES_CHANNEL_HOST_MAP'] = previousHostMap;
  });

  beforeEach(async () => {
    await assignOrganizationChannels(h, TEST_ORGANIZATION_ID, ['default']);
    await setChannelAnonymousAccess(h, 'default', true);
  });

  describe.each(['header', 'query', 'host'] as const)('channel named by %s', (signal) => {
    it('refuses an anonymous request on a closed channel, naming the channel', async () => {
      const res = await h.app.inject({ method: 'GET', ...request(signal, 'trade') });
      expect(res.statusCode).toBe(403);
      const error = errorOf(res);
      expect(error.code).toBe(ERROR_CODES.SALES_CHANNEL_SIGN_IN_REQUIRED);
      expect(error.details).toEqual({ channelCode: 'trade' });
      expect(res.headers['x-sales-channel']).toBe('trade');
      // Nothing of the channel's content travels with the refusal.
      expect(Object.keys(res.json() as object)).toEqual(['error']);
    });

    it('answers an anonymous request on an open channel', async () => {
      const res = await h.app.inject({ method: 'GET', ...request(signal, 'open-b') });
      expect(res.statusCode).toBe(200);
      expect(res.headers['x-sales-channel']).toBe('open-b');
    });

    it('refuses a customer whose Organization is not assigned, even on an open channel', async () => {
      const res = await h.app.inject({
        method: 'GET',
        ...request(signal, 'open-b'),
        cookies: CUSTOMER,
      });
      expect(res.statusCode).toBe(403);
      expect(errorOf(res)).toMatchObject({
        code: ERROR_CODES.SALES_CHANNEL_NOT_PERMITTED,
        details: { channelCode: 'open-b' },
      });
    });

    it('answers a customer whose Organization is assigned, on a closed channel too', async () => {
      await assignOrganizationChannels(h, TEST_ORGANIZATION_ID, ['default', 'trade', 'open-b']);
      for (const code of ['trade', 'open-b'] as const) {
        const res = await h.app.inject({
          method: 'GET',
          ...request(signal, code),
          cookies: CUSTOMER,
        });
        expect(res.statusCode, code).toBe(200);
      }
    });
  });

  describe('channel by system-default fallback', () => {
    it('answers anonymous and assigned customers on an open default channel', async () => {
      expect((await h.app.inject({ method: 'GET', url: PROBE })).statusCode).toBe(200);
      expect(
        (await h.app.inject({ method: 'GET', url: PROBE, cookies: CUSTOMER })).statusCode,
      ).toBe(200);
    });

    it('refuses an anonymous request with no channel signal when the default is closed', async () => {
      await setChannelAnonymousAccess(h, 'default', false);
      const res = await h.app.inject({ method: 'GET', url: PROBE });
      expect(res.statusCode).toBe(403);
      expect(errorOf(res)).toMatchObject({
        code: ERROR_CODES.SALES_CHANNEL_SIGN_IN_REQUIRED,
        details: { channelCode: 'default' },
      });
    });

    it('refuses a customer with no channel signal when the default is not assigned', async () => {
      await assignOrganizationChannels(h, TEST_ORGANIZATION_ID, ['trade']);
      const res = await h.app.inject({ method: 'GET', url: PROBE, cookies: CUSTOMER });
      expect(res.statusCode).toBe(403);
      expect(errorOf(res).code).toBe(ERROR_CODES.SALES_CHANNEL_NOT_PERMITTED);
    });
  });

  it('decides on the new assignment on the very next request of the writing process', async () => {
    const before = await h.app.inject({
      method: 'GET',
      ...request('header', 'trade'),
      cookies: CUSTOMER,
    });
    expect(before.statusCode).toBe(403);
    await assignOrganizationChannels(h, TEST_ORGANIZATION_ID, ['default', 'trade']);
    const after = await h.app.inject({
      method: 'GET',
      ...request('header', 'trade'),
      cookies: CUSTOMER,
    });
    expect(after.statusCode).toBe(200);
  });

  it('refuses a customer with no Organization instead of treating it as anonymous', async () => {
    const res = await h.app.inject({
      method: 'GET',
      ...request('header', 'open-b'),
      cookies: NO_ORG_CUSTOMER,
    });
    expect(res.statusCode).toBe(403);
    expect(errorOf(res).code).toBe(ERROR_CODES.SALES_CHANNEL_NOT_PERMITTED);
  });

  it('decides an impersonated customer as the customer', async () => {
    const start = await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/organizations/${TEST_ORGANIZATION_ID}/impersonate`,
      payload: { customerAccountId: TEST_CUSTOMER_ID, reason: 'channel access check' },
      cookies: ADMIN,
    });
    expect(start.statusCode).toBe(200);
    const raw = [start.headers['set-cookie'] ?? []].flat();
    const session = raw
      .map((c) => /^b2b_session=([^;]+)/.exec(c)?.[1])
      .find((v): v is string => v !== undefined);
    expect(session).toBeDefined();

    const refused = await h.app.inject({
      method: 'GET',
      ...request('header', 'trade'),
      cookies: { b2b_session: session! },
    });
    expect(refused.statusCode).toBe(403);
    expect(errorOf(refused).code).toBe(ERROR_CODES.SALES_CHANNEL_NOT_PERMITTED);

    const answered = await h.app.inject({
      method: 'GET',
      url: PROBE,
      cookies: { b2b_session: session! },
    });
    expect(answered.statusCode).toBe(200);
  });

  it('does not decide administrator requests', async () => {
    const res = await h.app.inject({
      method: 'GET',
      ...request('header', 'trade'),
      cookies: { b2b_admin_session: 'stub-admin-session' },
    });
    expect(res.statusCode).toBe(200);
  });

  it('does not decide API-key requests, bound or unbound', async () => {
    const mint = async (payload: Record<string, unknown>): Promise<string> => {
      const res = await h.app.inject({
        method: 'POST',
        url: '/api/v1/admin/api-keys',
        payload,
        cookies: ADMIN,
      });
      expect(res.statusCode).toBe(201);
      return (res.json() as { data: { bearerToken: string } }).data.bearerToken;
    };
    const trade = await h.salesChannels.resolver.getByCode('trade');
    const bound = await mint({
      name: 'Bound trade key',
      scopes: ['catalog:read'],
      binding: {
        organizationId: TEST_ORGANIZATION_ID,
        salesChannelId: trade!.id,
        customerAccountId: TEST_CUSTOMER_ID,
      },
    });
    const unbound = await mint({ name: 'Unbound key', scopes: ['catalog:read'] });

    const boundRes = await h.app.inject({
      method: 'GET',
      url: PROBE,
      headers: { authorization: `Bearer ${bound}` },
    });
    expect(boundRes.statusCode).toBe(200);
    expect(boundRes.headers['x-sales-channel']).toBe('trade');

    const unboundRes = await h.app.inject({
      method: 'GET',
      ...request('header', 'trade'),
      headers: { 'x-sales-channel': 'trade', authorization: `Bearer ${unbound}` },
    });
    expect(unboundRes.statusCode).toBe(200);
  });

  it('leaves admin paths alone, whoever calls them', async () => {
    await setChannelAnonymousAccess(h, 'default', false);
    const res = await h.app.inject({
      method: 'GET',
      url: '/api/v1/admin/sales-channels',
      cookies: ADMIN,
    });
    expect(res.statusCode).toBe(200);
  });

  it('answers a browser preflight on a closed channel, so a permitted customer is not blocked by it', async () => {
    // A preflight carries no cookie, so it is always anonymous; refusing it
    // would stop every cross-origin call a signed-in buyer makes on a closed store.
    const res = await h.app.inject({
      method: 'OPTIONS',
      url: PROBE,
      headers: {
        origin: 'http://localhost:3000',
        'access-control-request-method': 'GET',
        'access-control-request-headers': 'x-sales-channel',
        'x-sales-channel': 'trade',
      },
    });
    expect(res.statusCode).toBe(204);
    expect(res.headers['access-control-allow-origin']).toBe('http://localhost:3000');
  });

  it('refuses an unknown channel with 400 before any access decision', async () => {
    const res = await h.app.inject({
      method: 'GET',
      url: PROBE,
      headers: { 'x-sales-channel': 'no-such-channel' },
    });
    expect(res.statusCode).toBe(400);
    expect(errorOf(res).code).toBe(ERROR_CODES.UNKNOWN_SALES_CHANNEL);
  });

  it('translates the refusal for a Polish reader', async () => {
    const res = await h.app.inject({
      method: 'GET',
      ...request('header', 'trade'),
      headers: { 'x-sales-channel': 'trade', 'accept-language': 'pl-PL' },
    });
    expect(res.statusCode).toBe(403);
    expect((res.json() as { error: { message: string } }).error.message).toBe(
      'Ten sklep jest dostępny tylko dla zalogowanych klientów. Zaloguj się.',
    );
  });
});

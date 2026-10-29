import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ERROR_CODES } from '@endora-commerce/contracts';
import { SalesChannel } from '@endora-commerce/platform/kernel';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { CustomerAccount } from '../../helpers/package-entities.js';

/**
 * Feature 154 — individual self-registration and the sales-channel access rule
 * (`contracts/storefront-api.md` §5, owner decision D6).
 *
 * - T035 (US1): `POST /api/v1/customers/register` signs the visitor in at once,
 *   so it is **not** open to the access step: on a store closed to anonymous
 *   visitors it is refused like any other anonymous request, and no account is
 *   created.
 * - T055 (US4): on an open store the new personal Organization gets exactly
 *   that store's channel, and the session issued with the registration is
 *   accepted there.
 */

const OPEN = 'rgc-open';
const CLOSED = 'rgc-closed';

const body = (email: string) => ({
  email,
  password: 'a-very-strong-pass',
  firstName: 'Stand',
  lastName: 'Alone',
  acceptedTermsVersion: 'v1',
});

describe('POST /api/v1/customers/register — sales channels (T035, T055)', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer();
    await h.settings.adminService.setValueForAllChannels(
      'customers.allow_registration_without_organization',
      true,
      null,
      { actorAdminUserId: null },
    );
    const em = h.em();
    for (const [code, anonymousAccess] of [
      [OPEN, true],
      [CLOSED, false],
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
  });

  it('refuses individual registration on a store closed to anonymous visitors, creating no account', async () => {
    const email = `rgc-closed-${Date.now()}@example.test`;
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/customers/register',
      headers: { 'x-sales-channel': CLOSED },
      payload: body(email),
    });
    expect(res.statusCode, res.body).toBe(403);
    expect((res.json() as { error: { code: string } }).error.code).toBe(
      ERROR_CODES.SALES_CHANNEL_SIGN_IN_REQUIRED,
    );
    expect(res.headers['set-cookie']).toBeUndefined();
    expect(await h.em().findOne(CustomerAccount, { email })).toBeNull();
  });

  it('gives the personal Organization exactly the open store registered on, and the session works there', async () => {
    const email = `rgc-open-${Date.now()}@example.test`;
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/customers/register',
      headers: { 'x-sales-channel': OPEN },
      payload: body(email),
    });
    expect(res.statusCode, res.body).toBe(201);
    const organizationId = (
      res.json() as { data: { customerAccount: { organizationId: string } } }
    ).data.customerAccount.organizationId;

    const channels = await h.salesChannels.membershipService.listChannelsForEntity(
      'organization',
      organizationId,
    );
    expect(channels.map((c) => c.code)).toEqual([OPEN]);

    const session = res.cookies.find((c) => c.name === 'b2b_session')?.value;
    expect(session).toBeTruthy();
    const me = await h.app.inject({
      method: 'GET',
      url: '/api/v1/me/customer',
      headers: { 'x-sales-channel': OPEN },
      cookies: { b2b_session: session! },
    });
    expect(me.statusCode, me.body).toBe(200);
  });

  it('gives the personal Organization exactly the default channel when no channel is named', async () => {
    const email = `rgc-default-${Date.now()}@example.test`;
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/customers/register',
      payload: body(email),
    });
    expect(res.statusCode, res.body).toBe(201);
    const organizationId = (
      res.json() as { data: { customerAccount: { organizationId: string } } }
    ).data.customerAccount.organizationId;
    const channels = await h.salesChannels.membershipService.listChannelsForEntity(
      'organization',
      organizationId,
    );
    expect(channels.map((c) => c.code)).toEqual(['default']);
  });
});

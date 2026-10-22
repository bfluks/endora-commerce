import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { randomBytes } from 'node:crypto';
import { ERROR_CODES } from '@endora-commerce/contracts';
import { SalesChannel } from '@endora-commerce/platform/kernel';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { Cart, CustomerAccount, Session } from '../../helpers/package-entities.js';
import { TEST_CUSTOMER_ID, TEST_ORGANIZATION_ID } from '../../helpers/test-actors.js';
import { STUB_CUSTOMER_PASSWORD } from '../../helpers/seed-organizations.js';
import { assignOrganizationChannels } from '../../helpers/sales-channel-access.js';
import { withModuleOff } from '../../helpers/off-state.js';

/**
 * Feature 154, US2 (T043) — customer password sign-in follows the channel
 * assignment (`contracts/storefront-api.md` §4, `channel-access-rule.md` §6).
 *
 * The sign-in route is open to the access step (a visitor of a closed store has
 * to be able to sign in), so the rule is decided by the sign-in itself, after a
 * correct password and a non-blocked account and before anything is issued: a
 * refused sign-in sets no cookie, creates no session row, starts no second
 * factor and leaves `lastLoginAt` alone. A wrong password is still answered 401
 * first, so the refusal tells nothing about assignments to somebody without
 * the password.
 */

const EMAIL = 'stub-customer@example.com';
const OTHER = 'lca-other';

function errorOf(res: { json: () => unknown }): {
  code: string;
  details?: Record<string, unknown>;
} {
  return (res.json() as { error: { code: string; details?: Record<string, unknown> } }).error;
}

describe('POST /api/v1/auth/customer/login — sales-channel access (T043)', () => {
  let h: BackendServerHandle;

  async function sessionCount(): Promise<number> {
    return h.em().count(Session, { customerAccountId: TEST_CUSTOMER_ID });
  }

  async function lastLoginAt(): Promise<number | null> {
    const account = await h.em().findOneOrFail(CustomerAccount, { id: TEST_CUSTOMER_ID });
    return account.lastLoginAt ? account.lastLoginAt.getTime() : null;
  }

  function login(channel: string | null, password = STUB_CUSTOMER_PASSWORD, cookies = {}) {
    return h.app.inject({
      method: 'POST',
      url: '/api/v1/auth/customer/login',
      headers: channel === null ? {} : { 'x-sales-channel': channel },
      cookies,
      payload: { email: EMAIL, password },
    });
  }

  beforeAll(async () => {
    h = await setupBackendServer();
    const em = h.em();
    em.create(SalesChannel, {
      code: OTHER,
      name: { 'en-US': OTHER },
      languages: ['en-US'],
      defaultLanguage: 'en-US',
      currencies: ['PLN'],
      defaultCurrency: 'PLN',
      active: true,
      anonymousAccess: true,
    });
    await em.flush();
    await h.salesChannels.cache.invalidateAll();
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  beforeEach(async () => {
    await assignOrganizationChannels(h, TEST_ORGANIZATION_ID, ['default']);
  });

  it('refuses a correct password on an unassigned channel, issuing nothing', async () => {
    const sessionsBefore = await sessionCount();
    const lastLoginBefore = await lastLoginAt();

    const res = await login(OTHER);

    expect(res.statusCode, res.body).toBe(403);
    expect(errorOf(res)).toMatchObject({
      code: ERROR_CODES.SALES_CHANNEL_NOT_PERMITTED,
      details: { channelCode: OTHER },
    });
    expect(res.headers['set-cookie']).toBeUndefined();
    expect(await sessionCount()).toBe(sessionsBefore);
    expect(await lastLoginAt()).toBe(lastLoginBefore);
  });

  it('answers a wrong password with 401 before the channel is considered', async () => {
    const res = await login(OTHER, 'not-the-password-at-all');
    expect(res.statusCode).toBe(401);
    expect(errorOf(res).code).toBe(ERROR_CODES.INVALID_CREDENTIALS);
  });

  it('signs in on an assigned channel', async () => {
    await assignOrganizationChannels(h, TEST_ORGANIZATION_ID, ['default', OTHER]);
    const res = await login(OTHER);
    expect(res.statusCode, res.body).toBe(200);
    expect((res.json() as { data: { status: string } }).data.status).toBe('authenticated');
    expect(res.cookies.find((c) => c.name === 'b2b_session')?.value).toBeTruthy();
  });

  it('signs in on the default channel when no channel is named and the default is assigned', async () => {
    const res = await login(null);
    expect(res.statusCode, res.body).toBe(200);
  });

  it('starts no second factor on an unassigned channel', async () => {
    // Enforced and not enrolled: a permitted sign-in would answer
    // `mfaSetupRequired` and issue a set-up ticket.
    await h.settings.adminService.setValueForAllChannels(
      'mfa.storefront.totp_enforced',
      true,
      null,
      { actorAdminUserId: null },
    );
    try {
      const control = await login('default');
      expect((control.json() as { data: { status: string } }).data.status).toBe(
        'mfaSetupRequired',
      );

      const res = await login(OTHER);
      expect(res.statusCode).toBe(403);
      expect(errorOf(res).code).toBe(ERROR_CODES.SALES_CHANNEL_NOT_PERMITTED);
      expect(JSON.stringify(res.json())).not.toContain('setupTicket');
    } finally {
      await h.settings.adminService.setValueForAllChannels(
        'mfa.storefront.totp_enforced',
        false,
        null,
        { actorAdminUserId: null },
      );
    }
  });

  it('leaves the anonymous basket of a refused sign-in untouched', async () => {
    const channel = await h.salesChannels.resolver.getByCode(OTHER);
    const token = randomBytes(24).toString('base64url');
    const em = h.em();
    const cart = em.create(Cart, {
      anonymousCartToken: token,
      salesChannelId: channel!.id,
    });
    await em.flush();

    const res = await login(OTHER, STUB_CUSTOMER_PASSWORD, { b2b_cart_anon: token });
    expect(res.statusCode).toBe(403);
    // Not adopted, not merged, and its cookie is not cleared.
    expect(res.headers['set-cookie']).toBeUndefined();
    const after = await h.em().findOneOrFail(Cart, { id: (cart as { id: string }).id });
    expect(after.customerAccountId ?? null).toBeNull();
    expect(after.anonymousCartToken).toBe(token);
  });

  it('still refuses with the mfa module switched off (research R-14)', async () => {
    await withModuleOff('mfa', 'deactivated', async () => {
      const refused = await login(OTHER);
      expect(refused.statusCode).toBe(403);
      expect(errorOf(refused).code).toBe(ERROR_CODES.SALES_CHANNEL_NOT_PERMITTED);
      expect(refused.headers['set-cookie']).toBeUndefined();

      const permitted = await login('default');
      expect(permitted.statusCode, permitted.body).toBe(200);
    });
  });
});
